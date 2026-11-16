import { Client } from 'pg';
import type { TableMap } from './migration-map.ts';

// Помощники переноса: проверка карты, чтение, запись, самоссылки.
//
// ВЫНЕСЕНО ИЗ `migrate-from-1c.ts`: тот перешёл предел 200 строк из §12. Деление по смыслу:
// здесь — МЕХАНИКА (как читать и писать), там — ЧТО переносить и в каком порядке.
//
// ЗДЕСЬ ЖЕ СОБРАНЫ ТРИ РЕШЕНИЯ, найденные на ошибках, и каждое стоило отдельного прогона:
//   · проверка карты по обеим схемам — до первой записи;
//   · типы сравниваются наравне с именами;
//   · самоссылки вставляются пустыми и проставляюся отдельным шагом.

/**
 * ПРЕОБРАЗОВАНИЯ ТИПОВ, безопасные и потому явные.
 *
 * Проверка типов нашла 18 расхождений. Здесь — те, где потери быть не может:
 * `version` в legacy `bigint`, в прототипе `integer`, а счётчик версий записи не превысит
 * целое никогда.
 *
 * Остальные расхождения ТРЕБУЮТ РЕШЕНИЯ и потому не переносятся: `ref.car.year` (дата против
 * целого), `ref.car.color` (ссылка против текста), `ref.car_attribute.value_value`
 * (jsonb против текста). Выдумать приведение здесь значило бы соврать в данных.
 */
const CONVERT: Record<string, (v: unknown) => unknown> = {
  version: (v) => (v === null || v === undefined ? null : Number(v)),
};

/**
 * ЯВНЫЕ УМОЛЧАНИЯ для колонок, которые в приёмнике обязательны, а в источнике пусты.
 *
 * Это ЕШЕНИЕ, а не механика: перенос упал на `counterparty.inactive`, и подставить туда
 * «что-нибудь» молча нельзя — значение попадёт в учёт и повлияет на отчёты.
 */
const FILL: Record<string, unknown> = { inactive: false };

/**
 * САМОССЫЛКИ: колонки, указывающие на строку ТОЙ ЖЕ таблицы.
 *
 * Такие связи нельзя вставить сразу: строка не может существовать раньше себя. Первая
 * попытка упала на `nomenclature.analog_id`. Список вынесен явно: у любой другой таблицы
 * со ссылкой на себя будет та же беда, и её надо добавить сюда.
 */
const SELF_LINKS: { table: string; column: string }[] = [
  { table: 'nomenclature', column: 'analog_id' },
];

const colsOf = async (db: Client, schema: string, table: string): Promise<string[]> =>
  ((await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = $1 and table_name = $2`, [schema, table])).rows)
    .map((x) => x.column_name);

/**
 * ОБЩИЕ колонки двух таблиц — когда в карте список пуст.
 *
 * Список, выписанный руками, — это ВТОРАЯ КОПИЯ схемы, и она расходится с первой: проверка
 * нашла десять несуществующих колонок в моей карте. Пересечение вычисляется из самих баз.
 */
async function commonColumns(legacy: Client, proto: Client, from: string, to: string): Promise<string[]> {
  const [schema, table] = from.split('.');
  const l = await colsOf(legacy, schema!, table!);
  const p = await colsOf(proto, 'public', to);
  return l.filter((c) => p.includes(c));
}

/** КОЛОНКИ ДЛЯ ПЕРЕНОСА: объявленные в карте или вычисленные. */
export async function columnsFor(
  legacy: Client, proto: Client, map: TableMap,
): Promise<string[]> {
  return map.columns.length > 0
    ? map.columns
    : commonColumns(legacy, proto, map.from, map.to ?? '');
}

/**
 * ПРОВЕРКА КАРТЫ ПО ОБЕИМ СХЕМАМ — до первой записи.
 *
 * Карта утверждала, что в `arm.line` есть `sale_sum`. В источнике её нет, и перенос упал на
 * середине, уже прочитав часть таблиц. Карта без проверки — предположение: выглядит знанием
 * и молча расходится со схемой.
 *
 * СРАВНИВАЮТСЯ И ТИПЫ. Очередная ошибка была именно такой: колонка есть в обеих таблицах, но
 * в legacy это дата, а в прототипе целое. Совпадение имён не значит совпадение смысла.
 */
export async function checkMap(
  legacy: Client, proto: Client, maps: TableMap[],
): Promise<string[]> {
  const wrong: string[] = [];
  for (const map of maps) {
    const [schema, table] = map.from.split('.');
    const lRows = (await legacy.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = $1 and table_name = $2`, [schema, table])).rows;
    const pRows = (await proto.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = $1`, [map.to ?? ''])).rows;

    const lType = new Map(lRows.map((x) => [x.column_name, x.data_type]));
    const pType = new Map(pRows.map((x) => [x.column_name, x.data_type]));

    for (const c of await columnsFor(legacy, proto, map)) {
      if (!lType.has(c)) { wrong.push(`${map.from}.${c} — нет в ИСТОЧНИКЕ`); continue; }
      if (!pType.has(c)) { wrong.push(`${map.from}.${c} — нет в ПРИЁМНИКЕ`); continue; }
      const lt = lType.get(c)!;
      const pt = pType.get(c)!;
      // Колонки с объявленным преобразованием пропускаем: расхождение снято правилом.
      if (lt !== pt && !(c in CONVERT)) {
        wrong.push(`${map.from}.${c} — ТИП: в источнике ${lt}, в приёмнике ${pt}`);
      }
    }
  }
  return wrong;
}

/** Читает строки legacy. Удалённые не берём. Самоссылки при чтении обнуляются. */
export async function readRows(
  legacy: Client, map: TableMap,
): Promise<Record<string, unknown>[]> {
  const [schema, table] = map.from.split('.');
  const hasDeleted = ((await legacy.query<{ n: string }>(
    `select count(*)::text n from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = 'deleted'`,
    [schema, table])).rows[0]!.n) !== '0';

  const cols = (await columnsFor(legacy, {} as Client, map))
    .map((c) => `"${c}"`).join(', ');
  const where = hasDeleted ? 'where coalesce(deleted, false) = false' : '';
  const rows = (await legacy.query(`select ${cols} from "${schema}"."${table}" ${where}`))
    .rows as Record<string, unknown>[];

  // Самоссылки при вставке пустые: строка не может сослаться на себя.
  for (const link of SELF_LINKS) {
    if (link.table === table) for (const row of rows) row[link.column] = null;
  }
  return rows;
}

/** Записывает строки. `on conflict do nothing` — повторный прогон не удвоит. */
export async function writeRows(
  legacy: Client, proto: Client, map: TableMap, rows: Record<string, unknown>[],
): Promise<number> {
  if (map.to === null || rows.length === 0) return 0;
  const cols = await columnsFor(legacy, proto, map);
  const list = cols.map((c) => `"${c}"`).join(', ');
  const values = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `insert into ${map.to} (${list}) values (${values}) on conflict (id) do nothing`;

  let written = 0;
  for (const row of rows) {
    const params = cols.map((c) => {
      const v = row[c] ?? null;
      // Объявленное преобразование — первым: `version` в legacy `bigint`.
      if (v !== null && c in CONVERT) return CONVERT[c]!(v);
      if (v === null && c in FILL) return FILL[c];
      return v;
    });
    written += (await proto.query(sql, params)).rowCount ?? 0;
  }
  return written;
}

/** Проставляет самоссылки ПОСЛЕ вставки: обе стороны уже есть. */
export async function linkSelfReferences(
  legacy: Client, proto: Client, maps: TableMap[],
): Promise<{ table: string; column: string; linked: number }[]> {
  const done: { table: string; column: string; linked: number }[] = [];

  for (const link of SELF_LINKS) {
    const map = maps.find((m) => m.from.endsWith('.' + link.table));
    if (!map || map.to === null) continue;
    const [schema, table] = map.from.split('.');
    const source = await legacy.query(
      `select id, "${link.column}" as linked from "${schema}"."${table}"
        where "${link.column}" is not null`);

    let linked = 0;
    for (const row of source.rows as { id: string; linked: string }[]) {
      linked += (await proto.query(
        `update ${map.to} set "${link.column}" = $2 where id = $1`,
        [row.id, row.linked])).rowCount ?? 0;
    }
    done.push({ table: map.from, column: link.column, linked });
  }
  return done;
}
