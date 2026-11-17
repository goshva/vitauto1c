import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// БТ п. 20: «Документ редактирует тот пользователь, который его создал; просмотр — по
// профилю группы доступа. Профиль „Администратор“ имеет полный доступ».
//
// «РЕДАКТИРОВАНИЕ» ЗДЕСЬ — ЭТО УДАЛЕНИЕ. Проведение, отгрузка, приёмка — смена
// состояния документа, а не его правка, и закрывать их авторством значило бы
// запретить кладовщику провести приёмку, которую создал менеджер.
//
// ОТДЕЛЬНАЯ ПРОВЕРКА — что автор ЗАПИСЫВАЕТСЯ. Первая версия поставила проверку на
// удаление, а автор не записывался нигде, кроме заказа: `checkAuthor` при пустом авторе
// разрешает, и проверка молча пропускала всех. Проверка, которая всегда пропускает,
// хуже отсутствующей — она выглядит защитой.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
const SERVICE = '22222222-2222-2222-2222-222222222202';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const NOM = '77777777-7777-7777-7777-777777777702';

const manager = '11111111-aaaa-1111-1111-111111111102';
const store = '11111111-aaaa-1111-1111-111111111103';
const admin = '11111111-aaaa-1111-1111-111111111101';

const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;
const asOtherManager = `arm_session=${encodeSession({ userId: admin, role: 'manager' })}`;
const asStore = `arm_session=${encodeSession({ userId: store, role: 'storekeeper' })}`;

const json = async (url: string, init: RequestInit = {}, cookie = '') => {
  const r = await request(url, {
    ...init,
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = (url: string, body: unknown, cookie = '') =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, cookie);
const del = (url: string, cookie = '') => json(url, { method: 'DELETE' }, cookie);

const authorOf = async (table: string, id: string): Promise<string | null> =>
  (await pool.query<{ author_id: string | null }>(
    `select author_id from ${table} where id = $1`, [id])).rows[0]?.author_id ?? null;

/** Строка, готовая к приёмке или отгрузке. */
async function readyLine(status: string): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);
  await pool.query(
    `update line set nomenclature_id = $2, status = $3,
            warehouse_id = $4, cell_id = $5 where id = $1`,
    [id, NOM, status, WH, CELL]);
  return id;
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('БТ п. 20 · автор записывается при создании', () => {
  test('заказ клиента', async () => {
    const r = await post('/imports', {
      customerId: CUSTOMER, clientOrderNumber: 'З-АВТ',
      rows: [{ name: 'Фильтр', article: 'FLT-OIL-001', quantity: '1' }],
    }, asManager);
    // Кладовщику `request.create` закрыт: заявку он не заводит, он принимает товар.
    expect(await authorOf('customer_order', String(r.body.orderId))).toBe(manager);
  });

  test('приёмка', async () => {
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/receipts', {}, asStore);
    expect(await authorOf('receipt', String(r.body.id)), 'автор приёмки не записан').toBe(store);
  });

  test('отгрузка', async () => {
    const id = await readyLine('ready_to_ship');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/shipments', {}, asStore);
    expect(await authorOf('shipment', String(r.body.id)), 'автор отгрузки не записан').toBe(store);
  });

  test('возврат', async () => {
    const id = await readyLine('shipped');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/returns', { kind: 'client' }, asStore);
    expect(await authorOf('return_order', String(r.body.id)), 'автор возврата не записан').toBe(store);
  });

  test('заказ поставщику', async () => {
    const id = await readyLine('ordered');
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    const r = await post('/supplier-orders', {}, asManager);
    expect(await authorOf('supplier_order', String(r.body.id)), 'автор закупки не записан').toBe(manager);
  });

  test('заказ-наряд', async () => {
    const r = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE }, asManager);
    expect(await authorOf('work_order', String(r.body.id)), 'автор наряда не записан').toBe(manager);
  });
});

describe('БТ п. 20 · чужое удалить нельзя', () => {
  test('приёмку, созданную кладовщиком, другой сотрудник не удалит', async () => {
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/receipts', {}, asStore);
    const receiptId = String(r.body.id);

    // Другой пользователь с ПРАВОМ удаления (админ под ролью менеджера): право есть,
    // авторства нет. Это и есть проверяемая граница.
    const denied = await del(`/receipts/${receiptId}`, asOtherManager);
    expect(denied.status, 'чужую приёмку удалили').toBe(403);
    expect(denied.body.code).toBe('not_author');

    const alive = await pool.query(
      `select 1 from receipt where id = $1 and deleted_at is null`, [receiptId]);
    expect(alive.rowCount, 'документ всё-таки удалён').toBe(1);
  });

  test('АВТОР удаляет свой документ', async () => {
    // Проверяем на МЕНЕДЖЕРЕ, а не на кладовщике: у кладовщика нет права удалять
    // вовсе (`data.delete` — админ и менеджер), и «автор не смог» здесь означало бы
    // не про авторство, а про отсутствие права.
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    const r = await post('/receipts', {}, asManager);
    expect(await authorOf('receipt', String(r.body.id))).toBe(manager);

    const ok = await del(`/receipts/${String(r.body.id)}`, asManager);
    expect(ok.status, 'автор не смог удалить своё').toBe(200);
  });

  test('АДМИНИСТРАТОР удаляет чужое — у него полный доступ', async () => {
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/receipts', {}, asStore);

    const login = await request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login: 'admin', password: 'admin123' }).toString(),
    });
    const cookie = `arm_session=${
      /arm_session=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')![1]}`;

    const ok = await del(`/receipts/${String(r.body.id)}`, cookie);
    expect(ok.status, 'админ не смог удалить чужое').toBe(200);
  });

  test('отгрузку, созданную кладовщиком, менеджер не удалит', async () => {
    const id = await readyLine('ready_to_ship');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/shipments', {}, asStore);

    expect((await del(`/shipments/${String(r.body.id)}`, asOtherManager)).status).toBe(403);
  });

  test('возврат — та же граница', async () => {
    const id = await readyLine('shipped');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/returns', { kind: 'client' }, asStore);

    expect((await del(`/returns/${String(r.body.id)}`, asOtherManager)).status).toBe(403);
  });

  test('заказ поставщику — та же граница', async () => {
    const id = await readyLine('ordered');
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    const r = await post('/supplier-orders', {}, asManager);

    expect((await del(`/supplier-orders/${String(r.body.id)}`, asOtherManager)).status).toBe(403);
  });

  test('наряд — та же граница', async () => {
    const r = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE }, asManager);
    expect((await del(`/work-orders/${String(r.body.id)}`, asOtherManager)).status).toBe(403);
  });
});

describe('БТ п. 20 · порядок отказов и края', () => {
  test('отсутствие права важнее авторства: отказ называет ПЕРВУЮ причину', async () => {
    // Порядок проверок важен: «нельзя удалять вообще» и «нельзя удалять чужое» —
    // разные отказы, и первый обязан срабатывать первым. Иначе кладовщик, которому
    // удаление запрещено ВООБЩЕ, получал бы «вы не автор» — и шёл бы искать автора
    // вместо того, чтобы понять: удалять ему не дано.
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asManager);
    const r = await post('/receipts', {}, asManager);
    const receiptId = String(r.body.id);

    const denied = await del(`/receipts/${receiptId}`, asStore);
    expect(denied.status, 'кладовщик удалил документ').toBe(403);
    expect(denied.body.code, 'отказ про авторство вместо права')
      .toBe('forbidden');

    const alive = await pool.query(
      `select 1 from receipt where id = $1 and deleted_at is null`, [receiptId]);
    expect(alive.rowCount).toBe(1);
  });

  test('ПРОСМОТР чужого документа не закрыт', async () => {
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/receipts', {}, asStore);

    const view = await json(`/receipts/${String(r.body.id)}`, {}, asOtherManager);
    expect(view.status, 'просмотр закрыли вместе с изменением').toBe(200);
  });

  test('документ БЕЗ автора правит любой с правом — он его заполняет', async () => {
    const id = await readyLine('in_transit');
    await post(`/lines/${id}/mark`, { marked: true }, asStore);
    const r = await post('/receipts', {}, asStore);
    const receiptId = String(r.body.id);

    // Документы, заведённые до появления автора, ничьи. Отказывать им значило бы
    // сделать их недоступными навсегда.
    await pool.query(`update receipt set author_id = null where id = $1`, [receiptId]);

    expect((await del(`/receipts/${receiptId}`, asOtherManager)).status).toBe(200);
  });

  test('неизвестный документ → 404, а не «не автор»', async () => {
    const r = await del('/receipts/00000000-0000-0000-0000-0000000000ff', asOtherManager);
    expect(r.status).toBe(404);
  });
});
