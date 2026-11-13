import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Карта 82 столбцов `arm.line` → назначение. Источник — §4.2 задания.
// Скрипт превращает таблицу из markdown в машинный артефакт `db/map.json`,
// чтобы схема и тест сверялись с одним файлом, а не парсили документ.
//
// Детерминированность: повторный запуск даёт тот же файл (гейт этапа 1).

const SPEC = resolve(import.meta.dir, '../../prototype-spec.md');
const OUT = resolve(import.meta.dir, '../db/map.json');

const spec = readFileSync(SPEC, 'utf8');

const MARKERS = ['L', 'F', 'D', 'R', 'V', 'M', '✗'] as const;
type Marker = (typeof MARKERS)[number];

const map: Record<string, Marker> = {};
for (const m of spec.matchAll(/^\| (\d+) \| `([a-z0-9_]+)` \| (?:\*\*)?(L|F|D|R|V|M|✗)(?:\*\*)? \|/gm)) {
  const [, pos, name, mark] = m;
  const key = name!;
  if (map[key]) throw new Error(`столбец ${key} встречается дважды (строка карты ${pos})`);
  map[key] = mark as Marker;
}

const total = Object.keys(map).length;
if (total !== 82) throw new Error(`в карте ${total} столбцов, ожидалось 82`);

// Сверка разметки с §4.2, чтобы расхождение падало здесь, а не в тестах.
const counts = Object.fromEntries(MARKERS.map((mk) => [mk, Object.values(map).filter((v) => v === mk).length]));
const expected = { L: 36, F: 6, D: 12, R: 7, V: 8, M: 2, '✗': 11 };
for (const [mk, want] of Object.entries(expected)) {
  if (counts[mk] !== want) throw new Error(`метка ${mk}: ${counts[mk]}, ожидалось ${want}`);
}

const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

console.log(`db/map.json: ${total} столбцов, разметка ${JSON.stringify(counts)}`);
