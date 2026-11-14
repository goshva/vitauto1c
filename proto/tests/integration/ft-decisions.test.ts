import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Решения заказчика от 14.11.2026 (ответы на §6 плана сверки ФТ v2).
//
// Пять из них меняют код, и каждое здесь закреплено — иначе решение остаётся
// в переписке и теряется при первой же правке.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';

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
const patch = (url: string, body: unknown) =>
  json(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const firstLine = async (): Promise<string> =>
  String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);

const line = async (id: string) =>
  (await pool.query<{ sale_price: string | null; cost_price: string | null; coefficient: string | null }>(
    `select sale_price::text, cost_price::text, coefficient::text from line where id = $1`, [id])).rows[0]!;

const view = async (id: string) =>
  (await pool.query<{ coefficient: string | null; coefficientCalculated: boolean }>(
    `select coefficient::text, "coefficientCalculated" from line_view where id = $1`, [id])).rows[0]!;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('ФТ п. 1 · коэффициент — это МНОЖИТЕЛЬ', () => {
  test('коэффициент задаётся вручную и подставляет цену', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 1000 where id = $1`, [id]);

    const { status } = await patch(`/lines/${id}`, { field: 'coefficient', value: '1.5' });
    expect(status).toBe(200);

    const l = await line(id);
    // МНОЖИТЕЛЬ: 1000 × 1.5 = 1500. Будь это «наценка, %», вышло бы 1000 × 1.15.
    expect(String(l.sale_price), 'цена посчитана не как произведение').toContain('1500');
    expect(String(l.coefficient)).toContain('1.5');
  });

  test('коэффициент 1 даёт цену, равную себестоимости', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 800 where id = $1`, [id]);
    await patch(`/lines/${id}`, { field: 'coefficient', value: '1' });

    expect(String((await line(id)).sale_price)).toContain('800');
  });

  test('заданный коэффициент НЕ помечен как расчётный', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 1000 where id = $1`, [id]);
    await patch(`/lines/${id}`, { field: 'coefficient', value: '2' });

    const v = await view(id);
    expect(String(v.coefficient)).toContain('2');
    expect(v.coefficientCalculated, 'заданный множитель помечен расчётным').toBe(false);
  });

  test('цена руками → коэффициент пересчитывается САМ и помечен расчётным (ФТ)', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 1000 where id = $1`, [id]);
    await patch(`/lines/${id}`, { field: 'coefficient', value: '1.5' });

    // Менеджер вписал цену руками.
    await patch(`/lines/${id}`, { field: 'sale_price', value: '2500' });

    const l = await line(id);
    expect(l.coefficient, 'хранимый множитель не сброшен').toBe(null);

    const v = await view(id);
    expect(String(v.coefficient), 'коэффициент не пересчитан').toContain('2.5');
    expect(v.coefficientCalculated, 'коэффициент не помечен расчётным').toBe(true);
  });

  test('нулевая себестоимость не роняет расчёт — цена остаётся прежней', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 0, sale_price = 700 where id = $1`, [id]);

    const { status } = await patch(`/lines/${id}`, { field: 'coefficient', value: '3' });
    expect(status, 'деление на ноль не обработано').toBe(200);
    // Множитель сохранён, а цена не превратилась в ноль.
    expect(String((await line(id)).sale_price)).toContain('700');
  });

  test('изменение цены НЕ трогает себестоимость', async () => {
    const id = await firstLine();
    await pool.query(`update line set cost_price = 1000 where id = $1`, [id]);
    await patch(`/lines/${id}`, { field: 'sale_price', value: '1999' });

    expect(String((await line(id)).cost_price)).toContain('1000');
  });
});

describe('ФТ п. 3 · автосоздание заказа поставщику ОТКЛЮЧЕНО', () => {
  test('проведение заказа клиента не создаёт заказ поставщику', async () => {
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from supplier_order`)).rows[0]!.n);

    // Полный путь заявки: загрузка → задание → снабжение.
    await post('/imports', {
      customerId: CUSTOMER, clientOrderNumber: 'З-7701',
      rows: [{ name: 'Фильтр масляный', article: 'FLT-OIL-001', quantity: '2' }],
    });
    const ids = (await pool.query<{ id: string }>(
      `select id from line where not deleted order by order_date desc limit 2`)).rows;
    for (const r of ids) await post(`/lines/${r.id}/mark`, { marked: true });
    await post('/sales/jobs', {});
    await post('/supply/status', { to: 'paid' });

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from supplier_order`)).rows[0]!.n);
    expect(after, 'заказ поставщику создался САМ — заказчик это отключил').toBe(before);
  });

  test('заказ поставщику создаётся только явным вызовом', async () => {
    const { body: order } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
    expect(order.id).toBeTruthy();

    const id = await firstLine();
    await post(`/lines/${id}/mark`, { marked: true });
    await post('/sales/jobs', {});

    // «Задание» СНИМАЕТ отметки, а заказ поставщику строится по отмеченным —
    // отмечаем заново. Это и есть проверка: документ создаётся ЯВНЫМ действием.
    await post(`/lines/${id}/mark`, { marked: true });
    const created = await post('/supplier-orders', {});
    expect(created.status, 'явный вызов не работает').toBe(201);
  });

  test('в базе нет триггеров — автосозданию негде спрятаться', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.triggers where trigger_schema = 'public'`);
    expect(Number(r.rows[0]!.n), 'появился триггер с бизнес-логикой').toBe(0);
  });
});

describe('ФТ п. 13 · признак из колонки AD хранится ОТДЕЛЬНО', () => {
  test('у строки есть собственный признак, а не занятое поле цены', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.columns
        where table_name = 'line' and column_name = 'extra_flag'`);
    expect(Number(r.rows[0]!.n), 'признака AD нет').toBe(1);
  });

  test('признак независим от цены и суммы продажи', async () => {
    const id = await firstLine();
    const l = await line(id);
    await pool.query(`update line set extra_flag = true where id = $1`, [id]);

    const after = await line(id);
    expect(after.sale_price, 'признак затёр цену').toBe(l.sale_price);
    expect(after.cost_price, 'признак затёр себестоимость').toBe(l.cost_price);
  });
});

describe('ФТ п. 5 · себестоимость закрыта кладовщику', () => {
  test('кладовщик не получает себестоимость в списке', async () => {
    const r = await app.request('/lines?limit=3', {
      headers: { accept: 'application/json', 'x-role': 'storekeeper' },
    });
    const body = (await r.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).not.toHaveProperty('costPrice');
  });
});
