import { Client } from 'pg';
import { DOCUMENTS, EXPECTED, REFERENCES } from './migration-map.ts';
import {
  checkMap, linkSelfReferences, readRows, writeRows,
} from './migration-lib.ts';

// ПЕРЕНОС ДАННЫХ ИЗ 1С (волна 2, пункт 9).
//
//   bun run scripts/migrate-from-1c.ts            — ПРИМЕРКА: показывает, что будет
//   bun run scripts/migrate-from-1c.ts --apply    — переносит
//
// ПРИМЕРКА ПО УМОЛЧАНИЮ. Перенос НЕОБРАТИМ, а ошибка в нём тихая: строки либо не доехали,
// либо доехали дважды, и заметно это не на экране, а при сверке остатков. Прогон без
// предварительного показа значил бы «сделали и надеемся».
//
// МЕХАНИКА — В `migration-lib.ts`: как читать, как писать, как проверять карту, как
// обходиться с самоссылками. Здесь — ЧТО переносить и в каком порядке.
//
// ПРЯМОЕ ПОДКЛЮЧЕНИЕ К ДВУМ БАЗАМ, А НЕ `psql`: в значениях кириллица, и в аргументе
// командной строки она превращается в CP866 — я на этом попадался пять раз.

const APPLY = process.argv.includes('--apply');

const legacy = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_app' });
const proto = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5434/vitauto_proto' });
await legacy.connect();
await proto.connect();

const problems: string[] = [];

// --- ПРОВЕРКА КАРТЫ: до первой записи ---------------------------------------------------
const wrongColumns = await checkMap(legacy, proto, [...REFERENCES, ...DOCUMENTS]);
if (wrongColumns.length > 0) {
  console.error('КАРТА НЕ СХОДИТСЯ СО СХЕМОЙ:');
  for (const w of wrongColumns) console.error('  · ' + w);
  console.error('\nПеренос не начат: сначала поправьте карту.');
  await legacy.end();
  await proto.end();
  process.exit(1);
}
console.log('карта сверена со схемой: расхождений нет\n');
console.log(APPLY ? 'ПЕРЕНОС (данные будут записаны)' : 'ПРИМЕРКА (ничего не записывается)');
console.log('источник: vitauto_app → приёмник: vitauto_proto\n');

// --- Справочники: В ПОРЯДКЕ ЗАВИСИМОСТЕЙ ------------------------------------------------
//
// Порядок выяснился на ошибке: первая версия ставила `nomenclature` перед `unit`, и перенос
// упал на `nomenclature.unit_id` — ссылка на строку, которой ещё нет. То, на что ссылаются,
// идёт первым.
console.log('СПРАВОЧНИКИ (в порядке зависимостей):');
console.log('  таблица                  строк   перенесено  ожидалось');
let totalWritten = 0;

for (const map of REFERENCES) {
  const rows = await readRows(legacy, map);
  const written = APPLY ? await writeRows(legacy, proto, map, rows) : 0;
  totalWritten += written;

  const expect = EXPECTED[map.from];
  const ok = expect === undefined || rows.length === expect;
  if (!ok) problems.push(`${map.from}: прочитано ${rows.length}, ожидалось ${expect}`);

  console.log(`  ${map.from.padEnd(24)} ${String(rows.length).padStart(5)}   `
    + `${String(written).padStart(9)}  ${expect ?? '—'}  ${ok ? '' : 'РАСХОЖДЕНИЕ'}`);
}

// --- Самоссылки: ПОСЛЕ вставки ----------------------------------------------------------
if (APPLY) {
  for (const link of await linkSelfReferences(legacy, proto, REFERENCES)) {
    console.log(`  самоссылка ${link.table}.${link.column}: проставлено ${link.linked}`);
  }
}

// --- Документы и строки -----------------------------------------------------------------
console.log('\nДОКУМЕНТЫ И СТРОКИ:');
for (const map of DOCUMENTS) {
  const rows = await readRows(legacy, map);
  const written = APPLY ? await writeRows(legacy, proto, map, rows) : 0;
  totalWritten += written;
  console.log(`  ${map.from.padEnd(24)} ${String(rows.length).padStart(5)}   `
    + `${String(written).padStart(9)}`);
  if (map.to === null) {
    console.log('    (СВОДИТСЯ с arm.line по link_no — отдельным шагом, не копированием:');
    console.log('     копирование дало бы дубли строк, а в прототипе это одна таблица)');
  }
}

console.log(`\nвсего записано строк: ${APPLY ? totalWritten : '— (примерка ничего не пишет)'}`);

if (!APPLY) {
  console.log('\nЭто была ПРИМЕРКА. Для переноса: bun run scripts/migrate-from-1c.ts --apply');
  console.log('Перед этим снимите копию: bun run backup && bun run backup:verify');
}

if (problems.length > 0) {
  console.error('\nРАСХОЖДЕНИЯ С КАРТОЙ:');
  for (const p of problems) console.error('  · ' + p);
}

await legacy.end();
await proto.end();
process.exit(problems.length > 0 ? 1 : 0);
