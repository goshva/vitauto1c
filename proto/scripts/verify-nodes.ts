import { Client } from 'pg';
import { readFileSync } from 'node:fs';

// ПРОВЕРКА ПОКРЫТИЯ УЗЛОВ: все ли узлы всех процессов представлены.
//
//   bun run scripts/verify-nodes.ts
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА, А НЕ ГЛАЗАМИ. Узлов 36 в 11 процессах, и «вроде все» здесь
// не работает: пропущенный узел виден только тем, кто держит карту в голове. Проверка
// сверяет НЕ сид с сидом, а сид С КАРТОЙ ПРОЦЕССОВ — сид из карты и сгенерирован, поэтому
// сверка с ним самим ничего не докажет.
//
// ВАЖНО ПРО САМ СИД: он ЗАТИРАЕТСЯ прогоном тестов — те чистят движение и строки.
// Поэтому порядок такой: `db:seed --nodes`, потом проверка и просмотр. Тесты после этого
// снова его уберут, и это нормально: сид ручной проверки — не рабочие данные.

const map = JSON.parse(readFileSync('db/process-map.json', 'utf8')) as {
  scenarios: Record<string, { title?: string; steps: { n: number; nodes: string[]; status: string | null }[] }>;
};

/** Ожидание из карты. Состояние ПЕРЕНОСИТСЯ: шаг без своего состояния его не меняет. */
function expectedRows(): { process: string; node: string; status: string }[] {
  const out: { process: string; node: string; status: string }[] = [];
  for (const [pid, proc] of Object.entries(map.scenarios)) {
    let last: string | null = null;
    for (const st of proc.steps) {
      // Тип указан явно: без него `status` ссылается сам на себя через `last`, и TypeScript
      // выводит `any` — та же ошибка, что была в генераторе сида.
      const status: string = st.status ?? last ?? 'new';
      last = status;
      for (const node of st.nodes) out.push({ process: pid, node, status });
    }
  }
  return out;
}

const expected = expectedRows();

const db = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto' });
await db.connect();
const rows = (await db.query(
  `select l.status, l.comment, f.fact_article as node
     from line l join line_fact f on f.id = l.id
    where l.internal_order_number like 'ПРОВ-%'`)).rows as
  { status: string; comment: string; node: string }[];
await db.end();

const problems: string[] = [];

console.log('ПОКРЫТИЕ УЗЛОВ');
console.log(`  процессов: ${Object.keys(map.scenarios).length}, `
  + `узлов: ${new Set(expected.map((e) => e.node)).size}, `
  + `строк по карте: ${expected.length}, в базе: ${rows.length}\n`);

if (rows.length === 0) {
  console.error('СИД НЕ ЗАГРУЖЕН. Загрузите: bun run db:seed --nodes');
  console.error('(прогон тестов его затирает — это ожидаемо, сид ручной проверки не рабочие данные)');
  process.exit(1);
}

// 1. ПО ПРОЦЕССАМ.
console.log('ПО ПРОЦЕССАМ:');
console.log('  №   процесс                              строк  в базе  итог');
for (const [pid, proc] of Object.entries(map.scenarios)) {
  let last: string | null = null;
  let total = 0;
  for (const st of proc.steps) {
    last = st.status ?? last ?? 'new';
    total += st.nodes.length;
  }
  const inBase = rows.filter((r) => (r.comment ?? '').includes(`процесс ${pid} `)).length;
  const ok = inBase === total;
  if (!ok) problems.push(`процесс ${pid}: ${inBase} вместо ${total}`);
  console.log(`  ${pid.padStart(2)}  ${(proc.title ?? 'без названия').slice(0, 34).padEnd(36)} `
    + `${String(total).padStart(5)} ${String(inBase).padStart(7)}  ${ok ? 'полностью' : 'НЕ ПОЛНОСТЬЮ'}`);
}

// 2. ПО УЗЛАМ.
const need = new Map<string, number>();
for (const e of expected) need.set(e.node, (need.get(e.node) ?? 0) + 1);
const base = new Map<string, number>();
for (const r of rows) base.set(r.node, (base.get(r.node) ?? 0) + 1);

const missing = [...need.keys()].filter((n) => !base.has(n)).sort();
const wrong = [...need.entries()].filter(([n, c]) => (base.get(n) ?? 0) !== c);

console.log(`\nПО УЗЛАМ: в карте ${need.size}, в базе ${base.size}`);
console.log(`  не представлены: ${missing.length ? missing.join(', ') : 'нет'}`);
console.log(`  неверное число строк: ${wrong.length ? wrong.map(([n, c]) => `${n}: ${base.get(n)} вместо ${c}`).join('; ') : 'нет'}`);
if (missing.length) problems.push(`узлы не представлены: ${missing.join(', ')}`);

// 3. ПОДПИСЬ НАЗЫВАЕТ СВОЙ УЗЕЛ.
const wrongComment = rows.filter((r) => !(r.comment ?? '').includes(`узел ${r.node}`));
console.log(`  подпись не совпала с узлом: ${wrongComment.length ? wrongComment.length : 'нет'}`);
if (wrongComment.length) problems.push(`подпись не совпала: ${wrongComment.length}`);

// 4. НЕСУЩЕСТВУЮЩИЕ СОСТОЯНИЯ.
const VALID = new Set(['new', 'ordered', 'paid', 'in_transit', 'acceptance', 'assembly',
  'ready_to_ship', 'shipped', 'closed', 'return', 'reserve', 'to_stock', 'in_work',
  'partially_ordered', 'cancelled', 'refused', 'on_line', 'in_repair', 'written_off']);
const bad = rows.filter((r) => !VALID.has(r.status));
console.log(`  несуществующие состояния: ${bad.length ? bad.map((b) => `${b.node}="${b.status}"`).join(', ') : 'нет'}`);
if (bad.length) problems.push(`несуществующие состояния: ${bad.length}`);

// Список узлов: по нему проверяющий и идёт.
console.log('\nСПИСОК УЗЛОВ (для проверки по порядку):');
// Счётчик ИНКРЕМЕНТИРУЕТСЯ: первая версия заводила его нулём и не увеличивала, и в списке
// у всех узлов стояло «0» — при том, что проверка выше говорила «неверного числа нет».
// Две части одного вывода расходились между собой.
const byNode = new Map<string, { count: number; procs: Set<string> }>();
for (const e of expected) {
  if (!byNode.has(e.node)) byNode.set(e.node, { count: 0, procs: new Set() });
  const x = byNode.get(e.node)!;
  x.count++;
  x.procs.add(e.process);
}
console.log('  узел  строк  процессы');
for (const node of [...byNode.keys()].sort()) {
  const x = byNode.get(node)!;
  console.log(`  ${node.padEnd(5)} ${String(x.count).padStart(5)}  ${[...x.procs].sort((a, b) => Number(a) - Number(b)).join(', ')}`);
}

console.log('');
if (problems.length > 0) {
  console.error('НЕПОЛНОТА:');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('ВСЕ УЗЛЫ ВСЕХ ПРОЦЕССОВ ПРЕДСТАВЛЕНЫ.');
