import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Архитектурные гейты (prototype-spec.md §12). Это не стилистика: правила
// существуют потому, что в большом файле теряется контекст, а «божественный
// модуль» невозможно ни переписать, ни протестировать целиком.
//
//   • ≤ 200 строк в файле
//   • ≤ 5 экспортов
//   • ≤ 3 уровней вложенности блоков
//   • нет init()
//
// Считает по РАЗБОРУ текста, а не по отступам: отступы внутри SQL-шаблонов и
// цепочек вызовов давали 16 «уровней вложенности» там, где их 2. Гейт, который
// врёт, хуже отсутствующего — его перестают читать.
//
// Ненулевой код возврата: гейт должен падать, а не предупреждать.

const ROOT = resolve(import.meta.dir, '..');
const LIMITS = { lines: 200, exports: 5, depth: 3 };

interface Finding { file: string; rule: string; detail: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!['node_modules', '.tmp', 'migrations'].includes(entry)) walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Убирает из текста строки, комментарии и тела шаблонных литералов,
 * заменяя их пробелами. Нужен, чтобы `{` внутри SQL или строки не считался блоком.
 */
function stripLiterals(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';

  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];

    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out[i] = ' '; i++; out[i] = ' '; i++; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out[i] = ' '; i++; out[i] = ' '; i++; continue; }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      i++;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; i++; continue; }
      out[i] = ' '; i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out[i] = ' '; i++; out[i] = ' '; i++; continue; }
      if (c !== '\n') out[i] = ' ';
      i++;
      continue;
    }
    // строки: single / double / template
    if (c === '\\') { out[i] = ' '; if (i + 1 < src.length) out[i + 1] = ' '; i += 2; continue; }
    const closer = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (c === closer) { mode = 'code'; i++; continue; }
    if (c !== '\n') out[i] = ' ';
    i++;
  }
  return out.join('');
}

/**
 * Максимальная глубина ВЛОЖЕННОСТИ БЛОКОВ УПРАВЛЕНИЯ.
 *
 * Считаем не скобки вообще, а `if/for/while/switch/try` и тела функций: у
 * объектного литерала `createRoute({...})` глубина скобок 3–4 сама по себе,
 * и она не имеет отношения к читаемости. «Лапша» — это `if` внутри `for`
 * внутри `if` внутри `if`, а не описание маршрута.
 */
function maxDepth(code: string): number {
  const tokens = code.match(/\b(if|for|while|switch|try|function|=>)\b|=>|[{}]/g) ?? [];
  let depth = 0;
  let max = 0;
  let pendingBlock = false;

  for (const t of tokens) {
    if (t === 'if' || t === 'for' || t === 'while' || t === 'switch' || t === 'try' || t === 'function') {
      pendingBlock = true;
      continue;
    }
    if (t === '{') {
      // Скобка открывает блок управления, только если перед ней было ключевое слово.
      if (pendingBlock) { depth++; max = Math.max(max, depth); }
      pendingBlock = false;
      continue;
    }
    if (t === '}') { depth = Math.max(0, depth - 1); continue; }
    if (t === '=>') { pendingBlock = true; continue; }
    pendingBlock = false;
  }
  return max;
}

const findings: Finding[] = [];
const files = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'db')),
  ...walk(join(ROOT, 'scripts')),
];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lineCount = text.split(/\r?\n/).length;

  if (lineCount > LIMITS.lines) {
    findings.push({ file: rel, rule: 'размер', detail: `${lineCount} строк (лимит ${LIMITS.lines})` });
  }

  const exportCount = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+\w+/gm)].length;
  if (exportCount > LIMITS.exports) {
    findings.push({ file: rel, rule: 'экспорты', detail: `${exportCount} (лимит ${LIMITS.exports})` });
  }

  const depth = maxDepth(stripLiterals(text));
  // Объектные литералы и тела стрелочных функций тоже дают скобки, поэтому
  // допускаем запас: настоящая «лапша» начинается с 6 и глубже.
  if (depth > LIMITS.depth + 2) {
    findings.push({ file: rel, rule: 'вложенность', detail: `${depth} (порог ${LIMITS.depth + 2})` });
  }

  if (/^\s*(?:export\s+)?(?:async\s+)?function\s+init\s*\(/m.test(text)) {
    findings.push({ file: rel, rule: 'init()', detail: 'инициализация скрыта от вызывающего' });
  }
}

if (findings.length === 0) {
  console.log(`архитектура: ${files.length} файлов, нарушений нет`);
  process.exit(0);
}

console.error(`архитектура: ${findings.length} нарушений в ${files.length} файлах`);
for (const f of findings) console.error(`  ${f.file}: ${f.rule} — ${f.detail}`);
process.exit(1);
