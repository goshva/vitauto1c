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

// РЕМОНТ В ОТЧЁТЕ О ПРИБЫЛИ. Находка прогона месяца: наряд не отгружается, а отчёт
// требовал дату отгрузки — и две трети оборота проходили мимо (670 214,50 ₽
// из 1 003 087,80 ₽). Датой признания ремонта стало `work_order.closed_at`.
describe('отчётность · ремонт', () => {
  const WO = 'aa100000-0000-0000-0000-000000000001';
  const LABOR = 'aa200000-0000-0000-0000-000000000001';
  const PART = 'aa300000-0000-0000-0000-000000000001';
  const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

  /**
   * Наряд с работой (2 ч × 1500 = 3000) и запчастью (себестоимость 400, цена 600).
   * `closed` управляет датой признания: у закрытого наряда она есть, у открытого нет.
   */
  async function repairOrder(o: { closed: boolean; daysAgo?: number }): Promise<void> {
    const days = o.daysAgo ?? 5;
    await pool.query(`delete from line where work_order_id = $1`, [WO]);
    await pool.query(`delete from work_order where id = $1`, [WO]);

    await pool.query(
      `insert into work_order (id, number, date, status, car_id, counterparty_id,
         organization_id, service_type_id, closed_at)
       values ($1, 'ЗН-ОТЧЁТ-1', current_date - $2::int, $3, $4,
               '66666666-6666-6666-6666-666666666602',
               '55555555-5555-5555-5555-555555555501',
               '22222222-2222-2222-2222-222222222201',
               case when $3 = 'closed'
                    then now() - ($2::int || ' days')::interval else null end)`,
      [WO, days, o.closed ? 'closed' : 'new', CAR],
    );

    // Работа: заполнены нормо-часы — по ним она и отличается от запчасти.
    await pool.query(
      `insert into line (id, work_order_id, operation, status, quantity, service_type_id,
         norm_hours, sale_price, order_date, comment)
       values ($1, $2, 'sale', 'closed', 1, '22222222-2222-2222-2222-222222222201',
               2, 1500, current_date - $3::int, 'ОТЧЁТ-РЕМОНТ')`, [LABOR, WO, days]);

    // Запчасть: нормо-часов нет, считается как продажа.
    await pool.query(
      `insert into line (id, work_order_id, operation, status, quantity, nomenclature_id,
         cost_price, sale_price, order_date, comment)
       values ($1, $2, 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777702',
               400, 600, current_date - $3::int, 'ОТЧЁТ-РЕМОНТ')`, [PART, WO, days]);
  }

  test('ЗАКРЫТЫЙ наряд входит в отчёт: работа по часам, запчасть как продажа', async () => {
    await repairOrder({ closed: true });
    const t = totalsOf((await report('/reports/repair', asManager)).body);

    // Работа: 2 × 1500 = 3000, себестоимости нет. Запчасть: 600 − 400 = 200 прибыли.
    expect(t.revenue, 'выручка ремонта не попала в отчёт').toBe(3600);
    expect(t.cost, 'себестоимость запчасти наряда').toBe(400);
    expect(t.profit, 'прибыль ремонта').toBe(3200);
    expect(t.units, 'нормо-часы попали в штуки').toBe(1);
  });

  test('НЕЗАКРЫТЫЙ наряд в отчёт не входит', async () => {
    await repairOrder({ closed: false });
    const t = totalsOf((await report('/reports/repair', asManager)).body);
    expect(t.revenue, 'незакрытый наряд попал в выручку').toBe(0);
  });

  test('период фильтрует ремонт по дате закрытия наряда', async () => {
    await repairOrder({ closed: true, daysAgo: 10 });
    const today = new Date().toISOString().slice(0, 10);

    const inside = await report(
      `/reports/repair?dateFrom=${today}&dateTo=${today}`, asManager);
    expect(totalsOf(inside.body).revenue, 'старый наряд попал в сегодняшний день').toBe(0);

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const outside = await report(
      `/reports/repair?dateFrom=${tenDaysAgo}&dateTo=${tenDaysAgo}`, asManager);
    expect(totalsOf(outside.body).revenue, 'наряд не попал в свой день').toBe(3600);
  });

  test('СТРОКА С ОТГРУЗКОЙ И НАРЯДОМ СЧИТАЕТСЯ ОДИН РАЗ', async () => {
    // Товар из наряда всё-таки отгрузили. С раздельными отчётами он уходит из ремонта
    // в продажи — и не попадает в оба сразу.
    await repairOrder({ closed: true });
    const shipment = 'ff100000-0000-0000-0000-000000000001';
    await pool.query(
      `insert into shipment (id, number, date, status, operation, warehouse_id)
       values ($1, 'ОТ-ОТЧЁТ-1', current_date - 5, 'shipped', 'sale',
               '44444444-4444-4444-4444-444444444401') on conflict (id) do nothing`, [shipment]);
    await pool.query(`update line set shipment_doc_id = $2 where id = $1`, [PART, shipment]);

    const repair = totalsOf((await report('/reports/repair', asManager)).body);
    const sales = totalsOf((await report('/reports/profitability', asManager)).body);

    // В ремонте остаётся только работа (3000), запчасть (600) ушла в продажи.
    expect(repair.revenue, 'отгруженная запчасть осталась в ремонте').toBe(3000);
    expect(sales.revenue, 'запчасть не попала в продажи').toBe(600);
    expect(sales.cost, 'себестоимость запчасти').toBe(400);
    expect(repair.revenue + sales.revenue, 'строка посчитана дважды').toBe(3600);
  });

  test('оговорка говорит, что вошли и наряды', async () => {
    await repairOrder({ closed: true });
    const note = String((await report('/reports/repair', asManager)).body.note ?? '');
    expect(note, 'в оговорке нет ремонта').toContain('заказ-наряды');
    expect(note, 'не сказано, что работы считаются по нормо-часам').toContain('нормо-часам');
  });

  test('ПРОДАЖИ И РЕМОНТ РАЗДЕЛЕНЫ: в отчёте о продажах ремонта нет', async () => {
    // Решение заказчика 20.11.2026: у ремонта свой отчёт. Смешав их, нельзя было бы
    // ответить «сколько дала торговля» отдельно от «сколько дал ремонт».
    await repairOrder({ closed: true });

    const sales = totalsOf((await report('/reports/profitability', asManager)).body);
    const repair = totalsOf((await report('/reports/repair', asManager)).body);

    expect(sales.revenue, 'ремонт попал в отчёт о продажах').toBe(0);
    expect(repair.revenue, 'ремонт не попал в свой отчёт').toBe(3600);
    expect(sales.revenue + repair.revenue, 'вместе — вся выручка').toBe(3600);

    // И в оговорке продаж сказано, где искать ремонт.
    const salesNote = String((await report('/reports/profitability', asManager)).body.note ?? '');
    expect(salesNote, 'не сказано, что ремонт — отдельный отчёт').toContain('отдельным отчётом');
  });
});
