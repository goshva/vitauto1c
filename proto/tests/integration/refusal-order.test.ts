import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Три решения заказчика от 14.11.2026, меняющие модель.
//
//   п. 15 — «отказ это статус ЗАКАЗА»;
//   п.  6 — заказ-наряд нужен ТОЛЬКО когда заказаны детали, а монтаж делает сам
//           заказчик;
//   п. 17 — уведомления АРМ вместо задач 1С.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
const SERVICE = '22222222-2222-2222-2222-222222222202';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const NOM = '77777777-7777-7777-7777-777777777702';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Заказ клиента с двумя строками. */
async function orderWithLines(): Promise<{ orderId: string; lines: string[] }> {
  const { body } = await post('/imports', {
    customerId: CUSTOMER,
    clientOrderNumber: 'З-8801',
    rows: [
      { name: 'Фильтр масляный', article: 'FLT-OIL-001', quantity: '1' },
      { name: 'Фильтр салонный', article: 'FLT-CAB-001', quantity: '1' },
    ],
  });
  const orderId = String(body.orderId);
  const rows = await pool.query<{ id: string }>(
    `select id from line where customer_order_id = $1 and not deleted order by id`, [orderId]);
  return { orderId, lines: rows.rows.map((r) => r.id) };
}

const orderStatus = async (id: string): Promise<string> =>
  (await pool.query<{ status: string }>(
    `select status from customer_order where id = $1`, [id])).rows[0]!.status;

const lineStatuses = async (ids: string[]): Promise<string[]> =>
  (await pool.query<{ status: string }>(
    `select status from line where id = any($1::uuid[]) order by id`, [ids])).rows.map((r) => r.status);

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('ФТ п. 15 · отказ — состояние ЗАКАЗА', () => {
  test('заказ заводится в состоянии «Новый»', async () => {
    const { orderId } = await orderWithLines();
    expect(await orderStatus(orderId)).toBe('new');
  });

  test('отказ ставится НА ЗАКАЗ, а не на строки', async () => {
    const { orderId, lines } = await orderWithLines();
    const before = await lineStatuses(lines);

    const { status, body } = await post(`/orders/${orderId}/refuse`, {
      to: 'cancelled', reason: 'Клиент нашёл дешевле',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('cancelled');

    expect(await orderStatus(orderId), 'состояние заказа не изменилось').toBe('cancelled');
    expect(await lineStatuses(lines), 'состояния строк переписаны — склад не увидит, где товар')
      .toEqual(before);
  });

  test('причина и дата отказа сохраняются', async () => {
    const { orderId } = await orderWithLines();
    await post(`/orders/${orderId}/refuse`, { to: 'refused', reason: 'Не подошло по vin' });

    const r = await pool.query<{ refusal_reason: string | null; refused_at: Date | null }>(
      `select refusal_reason, refused_at from customer_order where id = $1`, [orderId]);
    expect(r.rows[0]!.refusal_reason).toBe('Не подошло по vin');
    expect(r.rows[0]!.refused_at, 'дата отказа не проставлена').not.toBeNull();
  });

  test('«Отменён» и «Отказался» — разные состояния', async () => {
    const a = await orderWithLines();
    const b = await orderWithLines();

    await post(`/orders/${a.orderId}/refuse`, { to: 'cancelled' });
    await post(`/orders/${b.orderId}/refuse`, { to: 'refused' });

    expect(await orderStatus(a.orderId)).toBe('cancelled');
    expect(await orderStatus(b.orderId)).toBe('refused');
  });

  test('недопустимое состояние отказа отвергается со списком', async () => {
    const { orderId } = await orderWithLines();
    const { status, body } = await post(`/orders/${orderId}/refuse`, { to: 'closed' });
    expect(status).toBe(400);
    expect(String(body.message ?? '')).toBeTruthy();
  });

  test('повторный отказ отвергается — причина уже записана', async () => {
    const { orderId } = await orderWithLines();
    await post(`/orders/${orderId}/refuse`, { to: 'cancelled', reason: 'первый' });

    const { status, body } = await post(`/orders/${orderId}/refuse`, { to: 'refused' });
    expect(status).toBe(409);
    expect(String(body.message ?? '')).toContain('отказа');
  });

  test('закрытый заказ отменить нельзя', async () => {
    const { orderId } = await orderWithLines();
    await pool.query(`update customer_order set status = 'closed' where id = $1`, [orderId]);

    const { status } = await post(`/orders/${orderId}/refuse`, { to: 'cancelled' });
    expect(status).toBe(409);
    expect(await orderStatus(orderId)).toBe('closed');
  });

  test('неизвестный заказ → 404', async () => {
    const { status } = await post('/orders/00000000-0000-0000-0000-0000000000ff/refuse',
      { to: 'cancelled' });
    expect(status).toBe(404);
  });

  test('в ответе видно, сколько строк уже уехало', async () => {
    const { orderId, lines } = await orderWithLines();
    // Одну строку доводим до «Отгружен» — её отказ не отменяет.
    await pool.query(`update line set status = 'shipped' where id = $1`, [lines[0]!]);

    const { body } = await post(`/orders/${orderId}/refuse`, { to: 'refused' });
    expect(body.shipped, 'отгруженная строка не посчитана').toBe(1);
    expect(body.lines).toBe(2);

    const after = await lineStatuses(lines);
    expect(after, 'отгруженная строка переписана отказом').toContain('shipped');
  });

  test('отказ строки по-прежнему доступен — состояния строк никто не отменял', async () => {
    const { lines } = await orderWithLines();
    await post(`/lines/${lines[0]!}/mark`, { marked: true });
    const { status } = await post('/lines/transition', { to: 'cancelled' });

    // Это НЕ отказ заказа: он нужен, когда клиент отказался от одной позиции.
    expect(status, 'отказ отдельной строки сломан').toBe(200);
  });
});

describe('ФТ п. 6 · заказ-наряд нужен для «детали без монтажа»', () => {
  test('наряд с ОДНИМИ запчастями, без работ, открывается и закрывается', async () => {
    // Случай из решения заказчика: детали заказаны, монтаж делает сам заказчик.
    const { body: order } = await post('/work-orders', {
      carId: CAR, counterpartyId: CUSTOMER, serviceTypeId: SERVICE,
      comment: 'Детали под монтаж силами заказчика',
    });
    const id = String(order.id);

    const part = await post(`/work-orders/${id}/part`, {
      nomenclatureId: NOM, quantity: '2', salePrice: '500',
    });
    expect(part.status, 'запчасть в наряд без работ не добавилась').toBe(201);

    // Работ в наряде нет — и это НОРМАЛЬНЫЙ случай, а не незаполненный.
    const works = await pool.query<{ n: string }>(
      `select count(*)::text n from line
        where work_order_id = $1 and norm_hours is not null and not deleted`, [id]);
    expect(Number(works.rows[0]!.n), 'в наряде появились работы').toBe(0);

    const parts = await pool.query<{ n: string }>(
      `select count(*)::text n from line
        where work_order_id = $1 and norm_hours is null and not deleted`, [id]);
    expect(Number(parts.rows[0]!.n), 'запчасть не попала в наряд').toBe(1);
  });

  test('наряд без работ печатается — бланк не падает на пустой таблице работ', async () => {
    const { body: order } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
    await post(`/work-orders/${String(order.id)}/part`, {
      nomenclatureId: NOM, quantity: '1', salePrice: '500',
    });

    const r = await app.request(`/print/work_order?workOrderId=${String(order.id)}`,
      { headers: { accept: 'text/html' } });
    expect(r.status, 'печать наряда без работ сломалась').toBe(200);
    expect(await r.text()).toContain('Фильтр');
  });

  test('нормо-часы и исполнитель — материал второго этапа, и он не обязателен', async () => {
    // Механика и нормо-часов в наряде «детали без монтажа» нет вовсе.
    const { body: order } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from line
        where work_order_id = $1 and (executor_id is not null or norm_hours is not null)`, 
      [String(order.id)]);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});

describe('ФТ п. 17 · уведомления АРМ, а не задачи 1С', () => {
  test('уведомления привязаны к заказу и живут в АРМ', async () => {
    const cols = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'notice'`);
    const names = cols.rows.map((c) => c.column_name);

    expect(names, 'уведомление не привязано к заказу').toContain('customer_order_id');
    expect(names, 'нет роли-получателя').toContain('recipient_role');
  });

  test('никакой интеграции с задачами 1С нет — своих таблиц достаточно', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.tables
        where table_schema = 'public' and table_name like '%1c%'`);
    expect(Number(r.rows[0]!.n), 'появилась таблица под интеграцию с 1С').toBe(0);
  });

  test('уведомление создаётся АРМ при смене состояния', async () => {
    const { lines } = await orderWithLines();
    await post(`/lines/${lines[0]!}/mark`, { marked: true });
    await post('/lines/transition', { to: 'reserve' });

    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from notice where customer_order_id is not null`);
    expect(Number(r.rows[0]!.n), 'уведомление не создалось').toBeGreaterThan(0);
  });
});
