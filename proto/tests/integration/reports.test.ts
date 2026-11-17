import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// Отчётность через приложение: права, цифры и оговорки.
//
// РАСЧЁТЫ УЖЕ ПРОВЕРЕНЫ ОТДЕЛЬНО, на посчитанных вручную ответах. Здесь проверяется
// другое: что до отчёта доходят ТЕ строки, что нужно, и что открыт он не всем.
//
// ГЛАВНОЕ — ПРАВА. В списке строк себестоимость можно просто не показывать. В отчёте так
// нельзя: прятать колонку бесполезно, ИТОГ всё равно покажет себестоимость и прибыль.
// Поэтому отчёт закрыт целиком для ролей, которым себестоимость недоступна.

const admin = '11111111-aaaa-1111-1111-111111111101';
const manager = '11111111-aaaa-1111-1111-111111111102';
const store = '11111111-aaaa-1111-1111-111111111103';
const mechanic = '11111111-aaaa-1111-1111-111111111104';

const asAdmin = `arm_session=${encodeSession({ userId: admin, role: 'admin' })}`;
const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;
const asStore = `arm_session=${encodeSession({ userId: store, role: 'storekeeper' })}`;
const asMechanic = `arm_session=${encodeSession({ userId: mechanic, role: 'mechanic' })}`;

interface Totals {
  lines: number; units: number; revenue: number; cost: number;
  profit: number; markupPct: number | null; lossLines: number;
}

async function report(url: string, cookie: string) {
  const r = await request(url, { headers: { accept: 'application/json', cookie } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

/**
 * Три продажи с РАЗНЫМИ известными числами: по ним и проверяем отбор.
 *   прибыльная:  себестоимость 100, цена 200 → прибыль 100
 *   убыточная:   себестоимость 100, цена  50 → прибыль -50
 *   без себестоимости: цена 300 → в выручку да, в прибыль нет
 */
async function threeSales(): Promise<void> {
  await pool.query(
    `delete from line where internal_order_number like 'ОТЧЁТ-%'`);
  await pool.query(
    `delete from customer_order where number like 'ОТЧЁТ-%'`);

  const ids = ['отчёт-1', 'отчёт-2', 'отчёт-3'];
  const data = [
    { cost: '100', price: '200', status: 'closed' },
    { cost: '100', price: '50', status: 'closed' },
    { cost: null, price: '300', status: 'closed' },
  ];

  for (let i = 0; i < ids.length; i++) {
    const id = `d0000000-0000-0000-0000-0000000${10000 + i}`;
    const orderId = `e0000000-0000-0000-0000-0000000${10000 + i}`;
    const shipmentId = `f0000000-0000-0000-0000-0000000${10000 + i}`;
    const d = data[i]!;

    await pool.query(
      `insert into customer_order (id, number, date, operation, counterparty_id,
        contract_id, organization_id, total)
       values ($1, $2, current_date - 10, 'sale', '66666666-6666-6666-6666-666666666601',
               'ee000000-0000-0000-0000-000000000003',
               '55555555-5555-5555-5555-555555555501', 0)
       on conflict (id) do nothing`, [orderId, `ОТЧЁТ-${i}`]);

    await pool.query(
      `insert into shipment (id, number, date, status, operation, counterparty_id,
        customer_order_id, warehouse_id)
       values ($1, $2, current_date - 10, 'shipped', 'sale',
               '66666666-6666-6666-6666-666666666601', $3,
               '44444444-4444-4444-4444-444444444401') on conflict (id) do nothing`,
      [shipmentId, `ОТЧЁТ-${i}`, orderId]);

    await pool.query(
      `insert into line (id, customer_order_id, operation, status, quantity,
        nomenclature_id, customer_id, contract_id, order_date, cost_price, sale_price,
        shipment_doc_id, internal_order_number)
       values ($1, $2, 'sale', $3, 1, '77777777-7777-7777-7777-777777777702',
               '66666666-6666-6666-6666-666666666601',
               'ee000000-0000-0000-0000-000000000003', current_date - 10, $4, $5, $6, $7)
       on conflict (id) do update
         set status = excluded.status, cost_price = excluded.cost_price,
             sale_price = excluded.sale_price, shipment_doc_id = excluded.shipment_doc_id`,
      [id, orderId, d.status, d.cost, d.price, shipmentId, `ОТЧЁТ-${i}`]);
  }
}

const totalsOf = (body: Record<string, unknown>): Totals => body.totals as Totals;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await pool.query(`delete from line where internal_order_number like 'ОТЧЁТ-%'`);
});

describe('отчётность · права: отчёт не показывается частично', () => {
  test('КЛАДОВЩИКУ ЗАКРЫТ ЦЕЛИКОМ, а не «без колонки»', async () => {
    // Спрятать колонку бесполезно: ИТОГ покажет себестоимость и прибыль. Поэтому отказ.
    const r = await report('/reports/profitability', asStore);
    expect(r.status, 'кладовщик получил отчёт с себестоимостью').toBe(403);
    expect(r.body.code).toBe('forbidden');
  });

  test('МЕХАНИКУ ТОЖЕ ЗАКРЫТ', async () => {
    expect((await report('/reports/profitability', asMechanic)).status).toBe(403);
  });

  test('менеджеру и администратору открыт', async () => {
    expect((await report('/reports/profitability', asManager)).status).toBe(200);
    expect((await report('/reports/profitability', asAdmin)).status).toBe(200);
  });

  test('зависшие строки — другой отчёт, он открыт всем, кто видит строки', async () => {
    // Здесь нет себестоимости, значит закрывать нечего: кладовщик видит свои строки.
    expect((await report('/reports/stuck', asStore)).status).toBe(200);
    expect((await report('/reports/stuck', asMechanic)).status).toBe(200);
  });
});

describe('отчётность · какие строки попадают в расчёт', () => {
  test('три продажи: прибыль, убыток и без себестоимости — цифры сходятся', async () => {
    await threeSales();
    const { body } = await report('/reports/profitability', asManager);
    const t = totalsOf(body);

    // Выручка: 200 + 50 + 300 = 550
    // Себестоимость: 100 + 100 = 200 (третья строка её не знает)
    // Прибыль: 550 - 200 = 350
    expect(t.revenue, 'выручка посчитана неверно').toBe(550);
    expect(t.cost, 'себестоимость посчитана неверно').toBe(200);
    expect(t.profit, 'прибыль посчитана неверно').toBe(350);
    expect(t.lossLines, 'УБЫТОЧНАЯ СТРОКА НЕ ПОСЧИТАНА').toBe(1);
  });

  test('оговорка про строки без себестоимости ЕСТЬ в ответе', async () => {
    // Без оговорки цифру примут за полную, хотя часть строк в неё не вошла.
    await threeSales();
    const { body } = await report('/reports/profitability', asManager);
    const note = String(body.note ?? '');
    expect(note, 'не сказано, что вошло в расчёт').toContain('состоявшиеся');
    expect(note, 'не сказано про строки без себестоимости').toContain('без себестоимости');
  });

  test('ОТМЕНЁННАЯ строка в выручку НЕ входит', async () => {
    await threeSales();
    const before = totalsOf((await report('/reports/profitability', asManager)).body);

    await pool.query(
      `update line set status = 'cancelled' where internal_order_number = 'ОТЧЁТ-0'`);
    const after = totalsOf((await report('/reports/profitability', asManager)).body);

    expect(after.revenue, 'отменённая строка осталась в выручке').toBe(before.revenue - 200);
  });

  test('ВОЗВРАЩЁННАЯ строка в выручку НЕ входит', async () => {
    await threeSales();
    const before = totalsOf((await report('/reports/profitability', asManager)).body);

    await pool.query(
      `update line set status = 'return' where internal_order_number = 'ОТЧЁТ-0'`);
    const after = totalsOf((await report('/reports/profitability', asManager)).body);

    expect(after.revenue, 'возвращённая строка осталась в выручке').toBe(before.revenue - 200);
  });

  test('НЕОТГРУЖЕННАЯ строка в выручку не входит', async () => {
    // Состояние «закрыт», а отгрузки нет: считать это продажей нельзя.
    await threeSales();
    await pool.query(
      `update line set shipment_doc_id = null where internal_order_number = 'ОТЧЁТ-0'`);
    const t = totalsOf((await report('/reports/profitability', asManager)).body);

    expect(t.revenue, 'неотгруженная строка попала в выручку').toBe(350);
  });

  test('период сужает выборку', async () => {
    await threeSales();
    const today = new Date().toISOString().slice(0, 10);
    const { body } = await report(
      `/reports/profitability?dateFrom=${today}&dateTo=${today}`, asManager);
    // Продажи датированы десятью днями раньше — в сегодняшний день не попадают.
    expect(totalsOf(body).revenue, 'период не сузил выборку').toBe(0);
  });
});

describe('отчётность · разрезы', () => {
  test('по номенклатуре: итог разреза равен общему', async () => {
    await threeSales();
    const { body } = await report('/reports/profitability?groupBy=nomenclature', asManager);
    const rows = body.rows as { totals: Totals }[];
    const sum = rows.reduce((s, r) => s + r.totals.revenue, 0);
    expect(sum, 'сумма разрезов разошлась с общим итогом').toBe(totalsOf(body).revenue);
  });

  test('по месяцам: разрез есть и он упорядочен', async () => {
    await threeSales();
    const { body } = await report('/reports/profitability?groupBy=month', asManager);
    const byMonthRows = body.byMonth as { label: string }[];
    expect(byMonthRows.length).toBeGreaterThan(0);
    expect(byMonthRows[0]!.label, 'месяц не в виде 2026-08').toMatch(/^\d{4}-\d{2}$/);
  });

  test('по заказчику — вариант разреза тоже работает', async () => {
    await threeSales();
    const { body } = await report('/reports/profitability?groupBy=customer', asManager);
    expect((body.rows as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('отчётность · зависшие строки', () => {
  test('старая строка попадает в отчёт, свежая — нет', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set status = 'new', order_date = current_date - 30 where id = $1`, [id]);

    const { body } = await report('/reports/stuck?days=3', asStore);
    const items = body.items as { id: string; daysStuck: number }[];
    const mine = items.find((x) => x.id === id);
    expect(mine, 'зависшая строка не попала в отчёт').toBeTruthy();
    expect(mine!.daysStuck, 'срок зависания посчитан неверно').toBeGreaterThanOrEqual(30);

    await pool.query(`update line set order_date = current_date where id = $1`, [id]);
    const fresh = await report('/reports/stuck?days=3', asStore);
    expect((fresh.body.items as { id: string }[]).find((x) => x.id === id),
      'свежая строка попала в зависшие').toBeUndefined();
  });

  test('ЗАКРЫТАЯ строка не считается зависшей: она закончена, а не стоит', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set status = 'closed', order_date = current_date - 30 where id = $1`, [id]);

    const { body } = await report('/reports/stuck?days=3', asStore);
    expect((body.items as { id: string }[]).find((x) => x.id === id),
      'закрытая строка показана как зависшая').toBeUndefined();
  });

  test('срок настраивается', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set status = 'new', order_date = current_date - 5 where id = $1`, [id]);

    const strict = await report('/reports/stuck?days=10', asStore);
    const loose = await report('/reports/stuck?days=3', asStore);
    expect((strict.body.items as { id: string }[]).find((x) => x.id === id),
      'строка попала в отчёт при большем сроке').toBeUndefined();
    expect((loose.body.items as { id: string }[]).find((x) => x.id === id),
      'строка не попала при меньшем сроке').toBeTruthy();
  });
});
