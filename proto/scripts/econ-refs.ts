import { pool } from '../src/db.ts';

// Справочные данные, на которые опирается месяц: номенклатура, ячейки, машины,
// заказчики, механик. Берутся из базы ПО КОДУ (артикул, название зоны), а не по
// фиксированным UUID: сиды справочников могут быть перезалиты, и месяц не должен
// ломаться от того, что идентификатор изменился.

interface EconRefs {
  /** Артикул → номенклатура (идентификатор и название для вставки листа). */
  nomenclature: Record<string, { id: string; name: string }>;
  /** Ячейка размещения (K2). */
  cell: string;
  /** Машины для заказ-нарядов (G1). */
  cars: string[];
  /** Заказчики (контрагенты с признаком «покупатель»). */
  customers: string[];
  /** Сотрудник-механик: на него записываются работы (Q3). */
  mechanic: string;
  /** Вид услуги для заказ-наряда. */
  serviceType: string;
}

const first = async (sql: string, params: unknown[] = []): Promise<string> => {
  const r = await pool.query<{ id: string }>(sql, params);
  if (r.rowCount === 0) throw new Error(`нет данных: ${sql.split('\n')[0]?.trim()}`);
  return r.rows[0]!.id;
};

const many = async (sql: string, params: unknown[] = []): Promise<string[]> => {
  const r = await pool.query<{ id: string }>(sql, params);
  return r.rows.map((x) => x.id);
};

export async function loadRefs(): Promise<EconRefs> {
  const nom = await pool.query<{ id: string; article: string; name: string }>(
    `select id, article, name from nomenclature where deleted_at is null and article is not null`,
  );
  const nomenclature: Record<string, { id: string; name: string }> = {};
  for (const row of nom.rows) nomenclature[row.article] = { id: row.id, name: row.name };

  return {
    nomenclature,
    cell: await first(`select id from storage_cell where code = 'K-01' and deleted_at is null`),
    cars: await many(`select id from car where deleted_at is null order by name`),
    customers: await many(`select id from counterparty where is_customer and not inactive order by name`),
    mechanic: await first(`select id from employee where role = 'mechanic' and deleted_at is null limit 1`),
    serviceType: await first(`select id from service_kind where deleted_at is null order by name limit 1`),
  };
}

/**
 * Строка по номеру заказа клиента.
 *
 * Вставка листа отвечает HTML-страницей, а не идентификатором: строка ищется по
 * номеру, который в неё положили. Это не обход, а единственный честный способ —
 * экран тоже ищет строку глазами по номеру.
 */
export async function lineIdByClientNumber(clientNumber: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    `select l.id from line l join line_fact f on f.id = l.id
      where f.client_order_number = $1 and not l.deleted
      order by l.created_at desc limit 1`,
    [clientNumber],
  );
  return r.rows[0]?.id ?? null;
}

export type { EconRefs };
