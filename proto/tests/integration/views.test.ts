import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PoolClient } from 'pg';
import { pool } from '../../src/db.ts';

// Гейт этапа 1: представления не просто существуют, а ВЕРНО СЧИТАЮТ.
//
// Изоляция через транзакцию (prototype-spec.md §2.6): каждый тест открывает
// транзакцию, пишет данные, проверяет и ОТКАТЫВАЕТ. Общих строк между тестами нет —
// именно на этом ломались тесты в legacy (6 «чужих отметок»).
//
// Откат обязателен: без него транзакция остаётся открытой, держит блокировки,
// и следующий тест висит на вставке до таймаута (проверено).

let client: PoolClient;

beforeEach(async () => {
  client = await pool.connect();
  await client.query('begin');
});

afterEach(async () => {
  await client.query('rollback');
  client.release();
});

const NOM = '11111111-1111-1111-1111-111111111111';
const WH = '22222222-2222-2222-2222-222222222222';
const LINE = '33333333-3333-3333-3333-333333333333';

async function seedLine(): Promise<void> {
  await client.query(
    `insert into line (id, nomenclature_id, warehouse_id, operation, quantity, sale_price, cost_price, status)
     values ($1, $2, $3, 'sale', 2, 500, 250, 'new')`,
    [LINE, NOM, WH],
  );
  await client.query(`insert into line_fact (id, fact_name, fact_qty) values ($1, 'Фильтр масляный', '2')`, [LINE]);
  await client.query(`insert into line_mark (id, marked) values ($1, true)`, [LINE]);
}

describe('stock_balance считает остатки из движений', () => {
  test('приход минус расход = остаток на складе', async () => {
    await client.query(
      `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity) values
        ($1, $2, 'receipt', 10), ($1, $2, 'receipt', 5), ($1, $2, 'expense', 3)`,
      [NOM, WH],
    );
    const r = await client.query<{ on_hand: string }>(
      `select on_hand from stock_balance where nomenclature_id = $1 and warehouse_id = $2`,
      [NOM, WH],
    );
    expect(Number(r.rows[0]!.on_hand)).toBe(12); // 10 + 5 − 3
  });

  test('резерв считается отдельно от остатка: товар лежит, но недоступен', async () => {
    await client.query(
      `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity) values
        ($1, $2, 'receipt', 10), ($1, $2, 'reserve', 4)`,
      [NOM, WH],
    );
    const r = await client.query<{ on_hand: string; reserved: string }>(
      `select on_hand, reserved from stock_balance where nomenclature_id = $1 and warehouse_id = $2`,
      [NOM, WH],
    );
    expect(Number(r.rows[0]!.on_hand)).toBe(10);
    expect(Number(r.rows[0]!.reserved)).toBe(4);
  });

  test('снятие резерва уменьшает резерв, а не остаток', async () => {
    await client.query(
      `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity) values
        ($1, $2, 'receipt', 10), ($1, $2, 'reserve', 4), ($1, $2, 'unreserve', 1)`,
      [NOM, WH],
    );
    const r = await client.query<{ on_hand: string; reserved: string }>(
      `select on_hand, reserved from stock_balance where nomenclature_id = $1 and warehouse_id = $2`,
      [NOM, WH],
    );
    expect(Number(r.rows[0]!.on_hand)).toBe(10);
    expect(Number(r.rows[0]!.reserved)).toBe(3);
  });
});

describe('line_totals считает суммы строки', () => {
  test('продажа и себестоимость = количество × цена', async () => {
    await seedLine();
    const r = await client.query<{ sale_sum: string; cost_sum: string; marked: boolean }>(
      `select sale_sum, cost_sum, marked from line_totals where line_id = $1`,
      [LINE],
    );
    expect(Number(r.rows[0]!.sale_sum)).toBe(1000); // 2 × 500
    expect(Number(r.rows[0]!.cost_sum)).toBe(500); // 2 × 250
    expect(r.rows[0]!.marked).toBe(true);
  });

  test('удалённые строки в итоги не попадают', async () => {
    await seedLine();
    await client.query(`update line set deleted = true where id = $1`, [LINE]);
    const r = await client.query(`select 1 from line_totals where line_id = $1`, [LINE]);
    expect(r.rowCount).toBe(0);
  });
});

describe('line_view отдаёт контракт списка', () => {
  test('49 колонок: id + operation + customer_order_id + 46 из 57 именованных', async () => {
    const r = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='line_view'`,
    );
    expect(r.rowCount).toBe(49);
  });

  test('отложены ровно 11 колонок документов — и никакие другие', async () => {
    const r = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='line_view'`,
    );
    const have = new Set(r.rows.map((x) => x.column_name));

    const deferred = [
      'assemblySentDate', 'paymentForm', 'paid', 'invoiceNumber', 'invoiceDate',
      'receiptDate', 'updDate', 'updNumber', 'supplierShipTerritory',
      'supplierOrderDate', 'deliveryTerm',
    ];
    for (const c of deferred) expect(have.has(c), `${c} не должен быть отдан`).toBe(false);

    // И наоборот: всё, что должно быть — есть.
    for (const c of ['marked', 'status', 'quantity', 'saleSum', 'costSum', 'stockQty',
      'reserveQty', 'inTransitQty', 'nomenclature', 'customer', 'factName', 'vin']) {
      expect(have.has(c), `${c} обязан быть в line_view`).toBe(true);
    }
  });

  test('строка попадает в представление вместе с фактом заявки и остатком', async () => {
    await seedLine();
    await client.query(
      `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity) values ($1, $2, 'receipt', 7)`,
      [NOM, WH],
    );
    const r = await client.query<{ factName: string; stockQty: string; saleSum: string; marked: boolean }>(
      // По id, а не по названию: после сида happy в базе есть вторая строка
      // с тем же factName, и поиск по названию мог вернуть не ту.
      `select "factName", "stockQty", "saleSum", marked from line_view where "id" = $1`,
      [LINE],
    );
    const row = r.rows[0];
    expect(row, 'строка не попала в line_view').toBeTruthy();
    expect(Number(row!.stockQty)).toBe(7);
    expect(Number(row!.saleSum)).toBe(1000);
    expect(row!.marked).toBe(true);
  });

  test('удалённая строка в представление не попадает', async () => {
    await seedLine();
    await client.query(`update line set deleted = true where id = $1`, [LINE]);
    // Проверяем именно СВОЮ строку по id, а не по названию: сид happy содержит
    // строку с тем же factName, и поиск по названию ловил бы её.
    const r = await client.query(`select 1 from line_view where "id" = $1`, [LINE]);
    expect(r.rowCount, 'удалённая строка осталась в представлении').toBe(0);
  });
});
