import { describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { line, lineFact, lineMark } from '../../db/schema/line.ts';
import map from '../../db/map.json' with { type: 'json' };

// Гейт этапа 1 (prototype-spec.md §4.2): схема обязана совпадать с картой 82 столбцов.
// Тест написан ДО миграции: проверяет определение таблиц в Drizzle, а не БД, —
// так расхождение «карта ↔ схема» ловится до того, как станет миграцией.
//
// Карта берётся из `db/map.json` (генерируется `bun run scripts/map.ts` из §4.2 задания),
// а не парсится из markdown на лету: markdown — документ, JSON — артефакт.

const MARKERS = map as Record<string, string>;
const byMark = (mark: string): string[] =>
  Object.entries(MARKERS).filter(([, m]) => m === mark).map(([n]) => n).sort();

const names = (table: Parameters<typeof getTableColumns>[0]): string[] =>
  Object.values(getTableColumns(table))
    .map((c) => c.name)
    .sort();

const LEGACY = [
  'onec_record_id',
  'onec_version',
  'onec_key',
  'cell_legacy',
  'import_batch_id',
  'manual_edit',
  'manual_batch',
  'manual_split_by_batch',
  'link_key',
  'sort_order',
  'extra',
];

/**
 * Столбцы, которых НЕ БЫЛО в исходных 82.
 *
 * Список закрытый: тест требует, чтобы «лишних» столбцов было ровно столько и
 * ровно этих. Иначе `line` тихо обрастает полями, и карта §4.2 перестаёт быть
 * документом о том, что получилось.
 *
 * `return_id`  — связь «возврат ↔ строки» (в legacy — таблица `doc.return_line`).
 * `work_order_id` — связь «заказ-наряд ↔ строки» (в legacy — `doc.work_order_labor`).
 *
 * Прототип держит ссылки на документы в самой строке: она их накапливает по мере
 * движения товара, и отдельная таблица ради одной связи не нужна.
 */
const ADDITIONS: Record<string, string[]> = {
  line: ['return_id', 'work_order_id'],
};

const documented = (table: string): string[] => ADDITIONS[table] ?? [];

describe('карта 82 столбцов', () => {
  test('содержит ровно 82 столбца', () => {
    expect(Object.keys(MARKERS).length).toBe(82);
  });

  test('разметка совпадает с §4.2: L36 F6 M2 V8 D12 R7 ✗11', () => {
    const count = (m: string) => byMark(m).length;
    expect({
      L: count('L'), F: count('F'), M: count('M'),
      V: count('V'), D: count('D'), R: count('R'), x: count('✗'),
    }).toEqual({ L: 36, F: 6, M: 2, V: 8, D: 12, R: 7, x: 11 });
  });
});

describe('line — столбцы по метке L плюс задокументированные добавления', () => {
  test('36 из карты + 2 добавленных = 38', () => {
    expect(names(line).length).toBe(byMark('L').length + documented('line').length);
    expect(names(line).length).toBe(38);
  });

  test('имена = метка L карты + ровно задокументированные добавления', () => {
    const expected = [...byMark('L'), ...documented('line')].sort();
    expect(names(line)).toEqual(expected);
  });

  test('ни одного столбца наследия 1С', () => {
    expect(names(line).filter((n) => LEGACY.includes(n))).toEqual([]);
  });

  test('есть поле version для If-Match', () => {
    expect(names(line)).toContain('version');
  });
});

describe('line_fact — 1:1 со строкой, 6 столбцов данных заявки', () => {
  test('7 столбцов: 6 перенесённых + id (= line_id)', () => {
    expect(names(lineFact).length).toBe(7);
  });

  test('содержит ровно метку F карты', () => {
    expect(names(lineFact).filter((n) => n !== 'id')).toEqual(byMark('F'));
  });
});

describe('line_mark — 1:1 со строкой, 2 столбца состояния сессии', () => {
  test('3 столбца: 2 перенесённых + id (= line_id)', () => {
    expect(names(lineMark).length).toBe(3);
  });

  test('содержит ровно метку M карты', () => {
    expect(names(lineMark).filter((n) => n !== 'id')).toEqual(byMark('M'));
  });
});

describe('82 столбца распределены без потерь', () => {
  test('L + F + M = 44 перенесённых, остальные 38 учтены как V/D/R/✗', () => {
    expect(byMark('L').length + byMark('F').length + byMark('M').length).toBe(44);
    expect(Object.keys(MARKERS).length - 44).toBe(38);
  });
});
