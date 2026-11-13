import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: заказы покупателя — 6 операций.
//
// У заказа НЕТ собственного статуса: он выводится из строк. Тесты проверяют
// именно это — что свод по заказу считается из строк на сервере, а закрытие
// заказа воздействует на строки, а не на отдельное поле.

const HAPPY_ORDER = 'a0000000-0000-0000-0000-00000000f001';
const HAPPY_LINE = 'b0000000-0000-0000-0000-000000000001';

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

const patch = (url: string, body: unknown, ifMatch?: string) =>
  json(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(ifMatch ? { 'if-match': ifMatch } : {}),
    },
    body: JSON.stringify(body),
  });

const lineStatus = async (id: string): Promise<string> =>
  (await pool.query<{ s: string }>(`select status s from line where id = $1`, [id])).rows[0]!.s;
const orderVersion = async (id: string): Promise<number> =>
  Number((await pool.query<{ v: string }>(`select version::text v from customer_order where id = $1`, [id])).rows[0]!.v);

beforeEach(async () => {
  await seedRefs();
  // Только happy: сид stock добавляет ВТОРОЙ заказ, и проверки «в списке один
  // заказ» / «после удаления ноль» становились бы неверными.
  await resetTo('happy');
});

describe('GET /orders — список и карточка', () => {
  test('заказ из сида виден в списке', async () => {
    const { status, body } = await get('/orders');
    expect(status).toBe(200);
    expect(body.total).toBe(1);

    const items = body.items as { number: string; customer: string; lines: number }[];
    expect(items[0]!.number).toBe('TEST-HAPPY-001');
    expect(items[0]!.customer).toContain('Иванов');
    expect(Number(items[0]!.lines)).toBe(1);
  });

  test('поиск по номеру заказа клиента', async () => {
    expect((await get('/orders?clientOrderNumber=HAPPY')).body.total).toBe(1);
    expect((await get('/orders?clientOrderNumber=НЕТУ')).body.total).toBe(0);
  });

  test('поиск экранирует символы LIKE', async () => {
    expect((await get('/orders?clientOrderNumber=%25')).body.total).toBe(0);
  });

  test('карточка отдаёт шапку, строки и свод', async () => {
    const { status, body } = await get(`/orders/${HAPPY_ORDER}`);
    expect(status).toBe(200);

    expect((body.header as { id: string }).id).toBe(HAPPY_ORDER);
    expect((body.lines as unknown[]).length).toBe(1);

    const summary = body.summary as { lines: number; byStatus: { status: string; n: string }[] };
    expect(summary.lines).toBe(1);
    expect(summary.byStatus.some((s) => s.status === 'new')).toBe(true);
  });

  test('свод считается из строк и пересчитывается после перехода', async () => {
    await pool.query(`update line set status = 'reserve' where id = $1`, [HAPPY_LINE]);
    const { body } = await get(`/orders/${HAPPY_ORDER}`);
    const summary = body.summary as { byStatus: { status: string; n: string }[] };
    expect(summary.byStatus.some((s) => s.status === 'reserve')).toBe(true);
    expect(summary.byStatus.some((s) => s.status === 'new')).toBe(false);
  });

  test('несуществующий заказ → 404', async () => {
    expect((await get('/orders/00000000-0000-0000-0000-0000000000ff')).status).toBe(404);
  });
});

describe('PATCH /orders/{id} — правка шапки', () => {
  test('меняет дату отгрузки и увеличивает версию', async () => {
    const v = await orderVersion(HAPPY_ORDER);
    const { status, body } = await patch(
      `/orders/${HAPPY_ORDER}`, { field: 'ship_date', value: '2026-12-01' }, String(v),
    );

    expect(status).toBe(200);
    expect(Number(body.version)).toBe(v + 1);
  });

  test('устаревший If-Match → 409 с обеими версиями', async () => {
    const v = await orderVersion(HAPPY_ORDER);
    const { status, body } = await patch(
      `/orders/${HAPPY_ORDER}`, { field: 'ship_date', value: '2026-12-01' }, String(v - 1),
    );

    expect(status).toBe(409);
    expect(body.code).toBe('version_conflict');
    expect(String(body.message)).toContain(`ожидалась версия ${v - 1}`);
  });

  test('вычисляемое поле не редактируется', async () => {
    const { status, body } = await patch(`/orders/${HAPPY_ORDER}`, { field: 'total', value: 999 });
    expect(status).toBe(400);
    expect(body.code).toBe('field_readonly');
    expect(body.field).toBe('total');
  });

  test('несуществующий заказ → 404', async () => {
    const { status } = await patch(
      '/orders/00000000-0000-0000-0000-0000000000ff', { field: 'ship_date', value: '2026-12-01' },
    );
    expect(status).toBe(404);
  });
});

describe('POST /orders/{id}/close — закрытие', () => {
  test('закрывает строки в допустимых состояниях', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY_LINE]);
    const { status, body } = await post(`/orders/${HAPPY_ORDER}/close`);

    expect(status).toBe(200);
    expect(body.closed).toBe(1);
    expect(body.skipped).toEqual([]);
    expect(await lineStatus(HAPPY_LINE)).toBe('closed');
  });

  test('строку в неподходящем статусе не закрывает, но перечисляет', async () => {
    // Строка в new: закрытие из new недоступно.
    const { status, body } = await post(`/orders/${HAPPY_ORDER}/close`);

    expect(status).toBe(200);
    expect(body.closed).toBe(0);
    expect((body.skipped as string[]).length).toBe(1);
    expect((body.skipped as string[])[0]).toContain('закрытие недоступно');
    expect(await lineStatus(HAPPY_LINE), 'статус не должен измениться').toBe('new');
  });

  test('повторное закрытие → 409', async () => {
    await pool.query(`update line set status = 'closed' where id = $1`, [HAPPY_LINE]);
    const { status, body } = await post(`/orders/${HAPPY_ORDER}/close`);

    expect(status).toBe(409);
    expect(body.code).toBe('already_closed');
  });

  test('заказ без строк закрыть нельзя', async () => {
    await pool.query(`update line set deleted = true where id = $1`, [HAPPY_LINE]);
    const { status, body } = await post(`/orders/${HAPPY_ORDER}/close`);

    expect(status).toBe(409);
    expect(String(body.message)).toContain('нет строк');
  });
});

describe('DELETE /orders/{id}', () => {
  test('заказ без отгруженных строк удаляется вместе со строками', async () => {
    const { status, body } = await json(`/orders/${HAPPY_ORDER}`, { method: 'DELETE' });

    expect(status).toBe(200);
    expect(body.lines).toBe(1);
    expect((await get('/orders')).body.total).toBe(0);

    const line = await pool.query(`select deleted from line where id = $1`, [HAPPY_LINE]);
    expect(line.rows[0]!.deleted).toBe(true);
  });

  test('заказ с отгруженной строкой удалить нельзя', async () => {
    await pool.query(`update line set status = 'shipped' where id = $1`, [HAPPY_LINE]);

    const { status, body } = await json(`/orders/${HAPPY_ORDER}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('не вернёт товар на склад');
    expect(String(body.message), 'нет подсказки про возврат').toContain('возврат');
  });

  test('удалённый заказ исчезает из карточки', async () => {
    await json(`/orders/${HAPPY_ORDER}`, { method: 'DELETE' });
    expect((await get(`/orders/${HAPPY_ORDER}`)).status).toBe(404);
  });
});
