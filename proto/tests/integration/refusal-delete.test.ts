import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { STATUS_TITLES } from '../../src/domain/status.ts';
import { allowedFrom } from '../../src/domain/transition.ts';

// ФТ v2 п. 15: запрет удаления и отказ клиента.
//
// «Право „Удаление“ снято для всех профилей кроме администратора» и «отказ клиента —
// статус „Отменён“/„Отказался“ в шапке или строке, без отдельного документа отмены».
//
// Проверяется и запрет, и то, что ПОСЛЕ отказа данные на месте: 403 на удаление
// бесполезен, если строка к этому моменту уже исчезла.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';

type Role = 'admin' | 'municipality' | 'manager' | 'mechanic' | 'storekeeper';
const as = (role: Role) => ({ 'x-role': role });

const req = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const withRole = (role?: Role) => (role ? as(role) : {});
const get = (url: string, role?: Role) =>
  req(url, { headers: { accept: 'application/json', ...withRole(role) } });
const post = (url: string, body?: unknown, role?: Role) =>
  req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...withRole(role) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const del = (url: string, role?: Role) =>
  req(url, { method: 'DELETE', headers: withRole(role) });
const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

/** Строка из сида процесса happy. */
const anyLine = async (): Promise<string> =>
  String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);

const lineExists = async (id: string): Promise<boolean> =>
  Number((await pool.query<{ n: string }>(
    `select count(*)::text n from line where id = $1`, [id])).rows[0]!.n) > 0;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№15 · право «Удаление» — админ и менеджер', () => {
  test('менеджер удаляет — заказчик разрешил (14.11.2026)', async () => {
    const id = await anyLine();
    const { status } = await del(`/lines/${id}`, 'manager');

    expect(status, 'менеджер потерял право удаления').toBe(200);
    const r = await pool.query<{ deleted: boolean }>(
      `select deleted from line where id = $1`, [id]);
    expect(r.rows[0]!.deleted).toBe(true);
  });

  test('кладовщик не удаляет строку', async () => {
    const id = await anyLine();
    expect((await del(`/lines/${id}`, 'storekeeper')).status).toBe(403);
    expect(await lineExists(id)).toBe(true);
  });

  test('механик и муниципалитет не удаляют — право узкое', async () => {
    for (const role of ['mechanic', 'municipality'] as const) {
      const id = await anyLine();
      expect((await del(`/lines/${id}`, role)).status, `${role} удалил строку`).toBe(403);
      expect(await lineExists(id)).toBe(true);
    }
  });

  test('администратор удаляет — право не сломано запретом', async () => {
    const id = await anyLine();
    const { status } = await del(`/lines/${id}`, 'admin');

    expect(status).toBe(200);
    // Мягкое удаление: строка помечена, но не исчезла из истории.
    const r = await pool.query<{ deleted: boolean }>(
      `select deleted from line where id = $1`, [id]);
    expect(r.rows[0]!.deleted).toBe(true);
  });

  test('массовое удаление — то же право', async () => {
    const id = await anyLine();
    await post(`/lines/${id}/mark`, { marked: true });

    const denied = await post('/lines/bulk-delete', {}, 'storekeeper');
    expect(denied.status).toBe(403);
    expect(await lineExists(id)).toBe(true);

    const allowed = await post('/lines/bulk-delete', {}, 'manager');
    expect(allowed.status).toBe(200);
  });

  test('удаление документов тоже закрыто для кладовщика', async () => {
    const { body: order } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });

    for (const url of [`/work-orders/${String(order.id)}`, '/orders/00000000-0000-0000-0000-0000000000ff']) {
      const { status } = await del(url, 'storekeeper');
      expect(status, `${url}: кладовщик удалил документ`).toBe(403);
    }
  });

  test('без заголовка роль admin — демо не ломается', async () => {
    const id = await anyLine();
    expect((await del(`/lines/${id}`)).status).toBe(200);
  });
});

describe('№15 · отказ клиента без отдельного документа', () => {
  test('«Отменён» доступен из ранних состояний и назван по-русски', async () => {
    expect(allowedFrom('new').map((t) => t.to)).toContain('cancelled');
    expect(allowedFrom('ordered').map((t) => t.to)).toContain('cancelled');
    expect(STATUS_TITLES.cancelled).toBe('Отменён');
  });

  test('«Отказался» — при получении, а не раньше', async () => {
    expect(allowedFrom('ready_to_ship').map((t) => t.to)).toContain('refused');
    expect(allowedFrom('shipped').map((t) => t.to)).toContain('refused');
    expect(allowedFrom('new').map((t) => t.to), 'отказ при получении доступен слишком рано')
      .not.toContain('refused');
    expect(STATUS_TITLES.refused).toBe('Отказался');
  });

  test('отмена строки проходит целиком и видна на экране', async () => {
    const id = await anyLine();
    await post(`/lines/${id}/mark`, { marked: true });

    const { status } = await post('/lines/transition', { to: 'cancelled' });
    expect(status, 'отмена не прошла').toBe(200);

    const r = await pool.query<{ status: string }>(`select status from line where id = $1`, [id]);
    expect(r.rows[0]!.status).toBe('cancelled');

    // На экране — слово, а не машинный код.
    const { body } = await html(`/lines?status=cancelled`);
    expect(body).toContain('Отменён');
    expect(body).not.toContain('>cancelled<');
  });

  test('документа отмены не создаётся — так требует ФТ', async () => {
    const before = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);

    const id = await anyLine();
    await post(`/lines/${id}/mark`, { marked: true });
    await post('/lines/transition', { to: 'cancelled' });

    const after = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from return_order`)).rows[0]!.n);
    expect(after, 'отмена завела отдельный документ').toBe(before);
  });

  test('отменённую строку нельзя отгрузить', async () => {
    const id = await anyLine();
    await post(`/lines/${id}/mark`, { marked: true });
    await post('/lines/transition', { to: 'cancelled' });

    await post(`/lines/${id}/mark`, { marked: true });
    const { status, body } = await post('/lines/transition', { to: 'assembly' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Отменён');
  });

  test('закрытая строка отмене не подлежит', async () => {
    const id = await anyLine();
    await pool.query(`update line set status = 'closed' where id = $1`, [id]);
    await post(`/lines/${id}/mark`, { marked: true });

    const { status } = await post('/lines/transition', { to: 'cancelled' });
    expect(status).toBe(409);
  });
});

describe('№15 · зона и маршруты не задеты', () => {
  test('перемещение в зону по-прежнему работает', async () => {
    const id = await anyLine();
    const { status } = await post(`/lines/${id}/zone`, { zoneId: '99999999-9999-9999-9999-999999999902' });
    expect(status).toBe(200);
  });

  test('приёмка и отгрузка по-прежнему работают', async () => {
    const { body: order } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
    expect(order.id).toBeTruthy();

    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '3',
    }, 'storekeeper');

    const { body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    expect(Number((body.items as { on_hand: string }[])[0]!.on_hand)).toBe(3);
  });

  test('заявка создаётся — право на удаление её не затронуло', async () => {
    const { status } = await post('/imports', {
      customerId: CUSTOMER,
      clientOrderNumber: 'З-9001',
      rows: [{ name: 'Масло моторное 5W-30', article: 'MOT5W30-5L', quantity: '1' }],
    }, 'manager');
    expect(status).toBe(201);
  });
});
