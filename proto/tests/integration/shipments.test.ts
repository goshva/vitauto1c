import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: отгрузка — 6 операций, состояние документа отдельно от статуса строк.
//
// Главная проверка: создание отгрузки НЕ меняет статус строки. Товар в этот момент
// ещё лежит на складе, и «отгружено» в момент оформления бумаги — расхождение,
// которое находят на складе, а не в тесте.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';

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

/** Готовит строку к отгрузке: отмечает и создаёт отгрузку. */
async function makeShipment(): Promise<string> {
  await mark(HAPPY);
  const { status, body } = await post('/shipments', {});
  expect(status, JSON.stringify(body)).toBe(201);
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('return_internal'); // строка в ready_to_ship
});

describe('POST /shipments — создание (K5)', () => {
  test('создаёт отгрузку, но НЕ меняет статус строки', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);

    const { status } = await post('/shipments', {});
    // Строка ещё не отмечена, поэтому приёмки не будет.
    expect(status).toBe(409);

    await mark(HAPPY);
    const ok = await post('/shipments', {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(String(ok.body.number)).toMatch(/^ОТ-\d{4}$/);
    expect(ok.body.lines).toBe(1);

    expect(await lineStatus(HAPPY), 'создание отгрузки сдвинуло статус строки')
      .toBe('ready_to_ship');
  });

  test('строка связывается с отгрузкой', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();

    const link = await pool.query(`select shipment_doc_id from line where id = $1`, [HAPPY]);
    expect(link.rows[0]!.shipment_doc_id).toBe(id);
  });

  test('строка не в том статусе → 409 с перечнем годных статусов', async () => {
    // happy в new — отгружать нечего.
    await mark(HAPPY);
    const { status, body } = await post('/shipments', {});

    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
    expect(String(body.message)).toContain('ready_to_ship');
    expect(String(body.message)).toContain('new');
  });

  test('самовывоз: строка в paid тоже годится к отгрузке', async () => {
    await pool.query(`update line set status = 'paid' where id = $1`, [HAPPY]);
    await mark(HAPPY);
    const { status, body } = await post('/shipments', {});
    expect(status, JSON.stringify(body)).toBe(201);
  });

  test('автомобиль и зона сохраняются', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    await mark(HAPPY);
    const { body } = await post('/shipments', {
      carId: 'cccccccc-cccc-cccc-cccc-cccccccccc01',
      zoneId: '99999999-9999-9999-9999-999999999906',
    });

    const { body: card } = await get(`/shipments/${String(body.id)}`);
    const header = card.header as { car_id: string; zone_id: string };
    expect(header.car_id).toBe('cccccccc-cccc-cccc-cccc-cccccccccc01');
    expect(header.zone_id).toBe('99999999-9999-9999-9999-999999999906');
  });
});

describe('GET /shipments — список и карточка', () => {
  test('список пуст, пока отгрузок нет', async () => {
    const { status, body } = await get('/shipments');
    expect(status).toBe(200);
    expect(body.total).toBe(0);
  });

  test('карточка отдаёт отгрузку со строками', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();

    const { status, body } = await get(`/shipments/${id}`);
    expect(status).toBe(200);
    expect((body.header as { id: string }).id).toBe(id);
    const lines = body.lines as { id: string; status: string }[];
    expect(lines.length).toBe(1);
    expect(lines[0]!.id).toBe(HAPPY);
  });

  test('фильтр по состоянию', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    await makeShipment();

    expect((await get('/shipments?status=new')).body.total).toBe(1);
    expect((await get('/shipments?status=closed')).body.total).toBe(0);
  });

  test('неизвестное состояние → 400 в формате Problem', async () => {
    const { status, body } = await get('/shipments?status=нетакого');
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });
});

describe('движение отгрузки', () => {
  test('отгрузка меняет статус строки на «Отгружен»', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();

    const { status, body } = await post(`/shipments/${id}/ship`);
    expect(status).toBe(200);
    expect(body.status).toBe('shipped');
    expect(body.lines).toBe(1);
    expect(await lineStatus(HAPPY)).toBe('shipped');
  });

  test('закрытие переводит строки в «Закрыт» (M15)', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();
    await post(`/shipments/${id}/ship`);

    const { body } = await post(`/shipments/${id}/close`);
    expect(body.status).toBe('closed');
    expect(await lineStatus(HAPPY)).toBe('closed');
  });

  test('закрыть неотгруженную нельзя — причина на языке оператора', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();

    const { status, body } = await post(`/shipments/${id}/close`);
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Создана');
    expect(String(body.message), 'машинное имя просочилось').not.toContain('shipped');
  });

  test('закрытая отгрузка дальше не двигается', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();
    await post(`/shipments/${id}/ship`);
    await post(`/shipments/${id}/close`);

    const again = await post(`/shipments/${id}/close`);
    expect(again.status).toBe(409);
    expect(String(again.body.message)).toContain('уже закрыта');
  });
});

describe('отмена отгрузки', () => {
  test('отмена отвязывает строку и возвращает её в «Собрано»', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();

    const { status, body } = await json(`/shipments/${id}`, { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.released, 'строка не освобождена от отгрузки').toBe(1);

    expect(await lineStatus(HAPPY)).toBe('ready_to_ship');
    const link = await pool.query(`select shipment_doc_id from line where id = $1`, [HAPPY]);
    expect(link.rows[0]!.shipment_doc_id).toBeNull();
  });

  test('после отмены строку можно отгрузить снова', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();
    await json(`/shipments/${id}`, { method: 'DELETE' });

    await mark(HAPPY);
    const again = await post('/shipments', {});
    expect(again.status).toBe(201);
  });

  test('закрытую отгрузку отменить нельзя', async () => {
    await pool.query(`update line set status = 'ready_to_ship' where id = $1`, [HAPPY]);
    const id = await makeShipment();
    await post(`/shipments/${id}/ship`);
    await post(`/shipments/${id}/close`);

    const { status, body } = await json(`/shipments/${id}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Закрытую отгрузку');
  });
});
