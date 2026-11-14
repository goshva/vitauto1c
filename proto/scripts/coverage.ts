import { execFileSync } from 'node:child_process';
import { PROCESSES } from '../src/domain/process-map.ts';

// Покрытие витрины: на КАЖДОМ узле каждого процесса есть заказ.
//
// Считаем не «сколько строк всего», а сколько пар «процесс × состояние» заполнено:
// именно пара означает, что узел можно показать на приёмке. Число строк об этом не
// говорит — одиннадцать строк процессов покрывают одиннадцать узлов из шестидесяти
// одного.
//
// Запуск: `bun run scripts/coverage.ts` (или `task proto:coverage`).
//
// Кириллица ВНУТРИ SQL ломает psql в этой среде («invalid byte sequence»), поэтому
// запрос идёт без неё, а разбор номеров — в JS.

const psql = 'C:\\Program Files\\PostgreSQL 1C\\18\\bin\\psql.exe';
const db = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto';
const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' };
const q = (sql: string): string =>
  execFileSync(psql, [db, '-Atc', sql], { encoding: 'utf8', env }).trim();
const rows = (sql: string): string[] => q(sql).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

const bun = `${process.env.APPDATA}\\npm\\node_modules\\bun\\bin\\bun.exe`;
execFileSync(bun, ['run', 'db/seed.ts', '--showcase'], { encoding: 'utf8', env, stdio: 'ignore' });

const SHOWCASE = '\u0412\u0418\u0422-';
const all = rows(`select internal_order_number || '|' || status from line
  where internal_order_number is not null and not deleted`);
const showcase = all.filter((r) => r.startsWith(SHOWCASE));

const byProcess = new Map<string, Set<string>>();
for (const row of showcase) {
  const [number, status] = row.split('|') as [string, string];
  const key = number.split('-')[1]!.toLowerCase();
  if (!byProcess.has(key)) byProcess.set(key, new Set());
  byProcess.get(key)!.add(status);
}

console.log(`строк витрины: ${showcase.length}\n`);
console.log('процесс              узлов  заполнено');

let pairs = 0;
let filled = 0;
const gaps: string[] = [];

for (const p of PROCESSES) {
  const statuses = [...new Set(p.steps.map((s) => s.status).filter(Boolean))] as string[];
  const have = byProcess.get(p.id.slice(0, 8).toLowerCase()) ?? new Set<string>();
  const missing = statuses.filter((s) => !have.has(s));

  pairs += statuses.length;
  filled += statuses.length - missing.length;
  for (const m of missing) gaps.push(`${p.id} · ${m}`);

  console.log(`  ${missing.length === 0 ? 'ok  ' : 'НЕТ '}${p.id.padEnd(17)} ` +
    `${String(statuses.length).padStart(2)}     ${statuses.length - missing.length}`);
  if (missing.length > 0) console.log(`        пусто: ${missing.join(', ')}`);
}

console.log(`\nпар «процесс × состояние»: ${pairs}`);
console.log(`заполнено: ${filled} · пусто: ${pairs - filled}`);
if (gaps.length > 0) console.log('  ' + gaps.join('\n  '));
console.log(`\nвсего строк в базе: ${q('select count(*) from line where not deleted')}`);
console.log(filled === pairs
  ? '\nВЫВОД: на каждом узле каждого процесса есть заказ'
  : '\nВЫВОД: есть пустые узлы — демонстрировать нечего');

// Ненулевой код возврата при пробелах: скрипт годится для гейта, а не только
// для чтения глазами.
if (filled !== pairs) process.exit(1);
