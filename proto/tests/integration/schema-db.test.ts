import { describe, expect, test } from 'bun:test';
import { pool } from '../../src/db.ts';
import map from '../../db/map.json' with { type: 'json' };

// Гейт этапа 1 на ЖИВОЙ БД: миграция должна создать ровно то, что обещает карта.
// Unit-тест (tests/unit/schema.test.ts) проверяет определение таблиц в Drizzle;
// этот — что миграция действительно применилась и в БД лежит то же самое.
//
// Требует DATABASE_URL на vitauto_proto. Если БД недоступна — тест падает,
// а не пропускается: изоляция проверяется явно (см. гейт «bun run db:migrate идемпотентен»).

const MARKERS = map as Record<string, string>;
const byMark = (m: string): string[] =>
  Object.entries(MARKERS).filter(([, v]) => v === m).map(([n]) => n).sort();

async function columnsOf(table: string): Promise<string[]> {
  const r = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

describe('миграция применилась к vitauto_proto', () => {
  test('три таблицы ядра существуют', async () => {
    const r = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
          and table_name in ('line','line_fact','line_mark')
        order by 1`,
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(['line', 'line_fact', 'line_mark']);
  });

  test('line в БД — 38 столбцов: 36 из карты §4.2 + 2 связи с документами', async () => {
    const cols = await columnsOf('line');
    expect(cols.length).toBe(38);
    // Сверяем с картой, а не с числом: 36 столбцов из §4.2 плюс ДВА
    // задокументированных добавления — связи с возвратом и заказ-нарядом.
    expect(cols).toEqual([...byMark('L'), 'return_id', 'work_order_id'].sort());
  });

  test('line_fact — 7, line_mark — 3', async () => {
    expect((await columnsOf('line_fact')).length).toBe(7);
    expect((await columnsOf('line_mark')).length).toBe(3);
  });

  test('в БД нет ни одного столбца наследия 1С', async () => {
    const all = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public'`,
    );
    const legacy = all.rows
      .map((r) => r.column_name)
      .filter((c) =>
        ['onec_key', 'onec_version', 'onec_record_id', 'extra', 'import_batch_id',
          'link_key', 'sort_order', 'cell_legacy', 'manual_edit', 'manual_batch',
          'manual_split_by_batch'].includes(c),
      );
    expect(legacy).toEqual([]);
  });

  test('If-Match опирается на индекс (id, version)', async () => {
    const r = await pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname='public' and tablename='line'`,
    );
    const byName = new Map(r.rows.map((x) => [x.indexname, x.indexdef]));

    // Индекс именно по паре (id, version): уникальность здесь не нужна —
    // id уже уникален как первичный ключ, а индекс нужен для скорости поиска
    // в `where id = $1 and version = $2`.
    const idx = byName.get('line_id_version_idx');
    expect(idx, 'нет индекса line_id_version_idx').toBeTruthy();
    expect(idx).toContain('(id, version)');

    // Уникальность версии обеспечивает первичный ключ — проверяем его отдельно,
    // а не «где-то в схеме есть UNIQUE INDEX».
    expect(byName.get('line_pkey')).toContain('UNIQUE');
  });

  test('line_fact и line_mark связаны со строкой внешним ключом', async () => {
    const r = await pool.query<{ conname: string }>(
      `select conname from pg_constraint
        where contype = 'f' and conrelid::regclass::text in ('line_fact','line_mark')
        order by 1`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });
});
