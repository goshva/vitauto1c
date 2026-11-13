import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: закупка — 7 операций. Закрывает процесс «Отмена заказа у поставщика»,
// который раньше выражался одной кнопкой: чем заказ отличался до и после отмены,
// из данных понять было нельзя.
//
// Состояние ДОКУМЕНТА отдельно от статуса строк: строка говорит, где товар,
// заказ — где договорённость с поставщиком.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const SUPPLIER = '66666666-6666-6666-6666-666666666604';

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

const get = (url: string) => json(url, { headers: { accept: 'application/json' } });
const mark = (id: string) => post(`/lines/${id}/mark`, { marked: true });

const lineStatus = async (id: string): Promise<string> =>
  (await pool.query<{ s: string }>(`select status s from line where id = $1`, [id])).rows[0]!.s;

/** Отмечает строку и создаёт заказ поставщику. Возвращает его идентификатор. */
async function makeOrder(): Promise<string> {
  await mark(HAPPY);
  const { status, body } = await post('/supplier-orders', { supplierId: SUPPLIER });
  expect(status, JSON.stringify(body)).toBe(201);
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('POST /supplier-orders — создание', () => {
  test('создаёт заказ в состоянии «Черновик» и привязывает строку', async () => {
    const id = await makeOrder();

    const { body } = await get(`/supplier-orders/${id}`);
    expect((body.header as { status: string }).status).toBe('new');
    expect((body.lines as unknown[]).length).toBe(1);

    const link = await pool.query(`select supplier_order_id from line where id = $1`, [HAPPY]);
    expect(link.rows[0]!.supplier_order_id).toBe(id);
  });

  test('создание НЕ меняет статус строки', async () => {
    await makeOrder();
    expect(await lineStatus(HAPPY)).toBe('new');
  });

  test('без годных строк → 409 с перечнем статусов', async () => {
    await pool.query(`update line set status = 'closed' where id = $1`, [HAPPY]);
    await mark(HAPPY);

    const { status, body } = await post('/supplier-orders', {});
    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
    expect(String(body.message)).toContain('new');
  });

  test('строка в «Заказан» тоже годится', async () => {
    await pool.query(`update line set status = 'ordered' where id = $1`, [HAPPY]);
    await mark(HAPPY);
    expect((await post('/supplier-orders', {})).status).toBe(201);
  });
});

describe('GET /supplier-orders — список и карточка', () => {
  test('список пуст, пока заказов нет', async () => {
    expect((await get('/supplier-orders')).body.total).toBe(0);
  });

  test('заказ виден с поставщиком и числом строк', async () => {
    await makeOrder();
    const items = (await get('/supplier-orders')).body.items as { supplier: string; lines: number }[];
    expect(items.length).toBe(1);
    expect(items[0]!.supplier).toContain('АвтооптТорг');
    expect(Number(items[0]!.lines)).toBe(1);
  });

  test('фильтр по состоянию', async () => {
    await makeOrder();
    expect((await get('/supplier-orders?status=new')).body.total).toBe(1);
    expect((await get('/supplier-orders?status=confirmed')).body.total).toBe(0);
  });

  test('неизвестное состояние → 400 в формате Problem', async () => {
    const { status, body } = await get('/supplier-orders?status=нетакого');
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });

  test('несуществующий заказ → 404', async () => {
    expect((await get('/supplier-orders/00000000-0000-0000-0000-0000000000ff')).status).toBe(404);
  });
});

describe('подтверждение и получение', () => {
  test('подтверждение переводит в «Подтверждён» (P1)', async () => {
    const id = await makeOrder();
    const { status, body } = await post(`/supplier-orders/${id}/confirm`);

    expect(status).toBe(200);
    expect(body.status).toBe('confirmed');
  });

  test('подтвердить дважды нельзя — причина на языке оператора', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/confirm`);

    const { status, body } = await post(`/supplier-orders/${id}/confirm`);
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Подтверждён');
    expect(String(body.message), 'машинное имя просочилось').not.toContain('confirmed');
  });

  test('получение переводит строки на склад', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/confirm`);

    const { body } = await post(`/supplier-orders/${id}/receive`);
    expect(body.status).toBe('received');
    expect(body.lines).toBe(1);
    expect(await lineStatus(HAPPY)).toBe('to_stock');
  });

  test('получить неподтверждённый заказ нельзя', async () => {
    const id = await makeOrder();
    const { status, body } = await post(`/supplier-orders/${id}/receive`);

    expect(status).toBe(409);
    expect(String(body.message)).toContain('Черновик');
  });
});

describe('отмена заказа у поставщика', () => {
  test('отмена возвращает строки в «Новый» — закупку можно начать заново', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/confirm`);

    const { status, body } = await post(`/supplier-orders/${id}/cancel`);
    expect(status).toBe(200);
    expect(body.status).toBe('cancelled');
    expect(await lineStatus(HAPPY), 'строка осталась в закупке').toBe('new');
  });

  test('отменить черновик тоже можно', async () => {
    const id = await makeOrder();
    expect((await post(`/supplier-orders/${id}/cancel`)).status).toBe(200);
  });

  test('после отмены заказ остаётся в истории', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/cancel`);

    expect((await get('/supplier-orders?status=cancelled')).body.total).toBe(1);
    expect((await get(`/supplier-orders/${id}`)).status).toBe(200);
  });

  test('полученный заказ отменить нельзя', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/confirm`);
    await post(`/supplier-orders/${id}/receive`);

    const { status, body } = await post(`/supplier-orders/${id}/cancel`);
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Получен');
  });
});

describe('удаление черновика', () => {
  test('черновик удаляется, строки освобождаются', async () => {
    const id = await makeOrder();
    const { status, body } = await json(`/supplier-orders/${id}`, { method: 'DELETE' });

    expect(status).toBe(200);
    expect(body.released).toBe(1);

    const link = await pool.query(`select supplier_order_id from line where id = $1`, [HAPPY]);
    expect(link.rows[0]!.supplier_order_id).toBeNull();
    expect((await get('/supplier-orders')).body.total).toBe(0);
  });

  test('подтверждённый удалить нельзя — сообщение ведёт к отмене', async () => {
    const id = await makeOrder();
    await post(`/supplier-orders/${id}/confirm`);

    const { status, body } = await json(`/supplier-orders/${id}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('только черновик');
    expect(String(body.message), 'нет подсказки про отмену').toContain('отмену');
  });
});
