import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { resetTo, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// НАЗНАЧЕНИЕ ПРОЦЕССА СТРОКЕ. Находка прогона месяца: `process_id` и `process_step`
// писали только сиды, поэтому строка, созданная через приложение, в процессе не
// числилась, и `/lines/step` отвечал ей `outside_process` — пошаговое движение
// работало лишь на демонстрационных данных (`docs/fix-plan.md` §4).
//
// Здесь проверяется и само назначение, и то, ради чего оно нужно: строка начинает
// двигаться по узлам. Право отдельное (`process.assign`) и проверяется отдельно.

const manager = `arm_session=${encodeSession({
  userId: '11111111-aaaa-1111-1111-111111111102', role: 'manager',
})}`;
const store = `arm_session=${encodeSession({
  userId: '11111111-aaaa-1111-1111-111111111103', role: 'storekeeper',
})}`;
const mechanic = `arm_session=${encodeSession({
  userId: '11111111-aaaa-1111-1111-111111111104', role: 'mechanic',
})}`;

const HEAD = 'Наименование;Артикул;Кол-во;Ед.;Гос. номер;Срочно;База;№ заказа';

const json = async (url: string, init?: RequestInit) => {
  const r = await request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

const post = (url: string, body: unknown, cookie?: string) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

/** Строка, созданная ЧЕРЕЗ ПРИЛОЖЕНИЕ: у неё процесса нет по построению. */
async function pasteLine(marker: string): Promise<{ id: string; processId: string | null }> {
  const pasted = `${HEAD}\nФильтр масляный;FLT-OIL-001;1;шт;;;Склад;${marker}`;
  const r = await request('/ui/lines/paste', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pasted, customerId: '' }).toString(),
  });
  expect(r.status, 'вставка листа не сработала').toBe(200);

  const found = await pool.query<{ id: string; process_id: string | null }>(
    `select l.id, l.process_id from line l join line_fact f on f.id = l.id
      where f.client_order_number = $1 and not l.deleted
      order by l.created_at desc limit 1`,
    [marker],
  );
  const row = found.rows[0];
  expect(row, `строка «${marker}» не создана`).toBeTruthy();
  return { id: row!.id, processId: row!.process_id };
}

const processOf = async (id: string): Promise<{ p: string | null; step: number | null; status: string }> => {
  const r = await pool.query<{ process_id: string | null; process_step: number | null; status: string }>(
    `select process_id, process_step, status from line where id = $1`, [id]);
  const row = r.rows[0]!;
  return { p: row.process_id, step: row.process_step, status: row.status };
};

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
});

describe('POST /lines/{id}/process — назначение процесса', () => {
  test('строку, созданную через API, можно поставить в процесс', async () => {
    const line = await pasteLine('ПРОЦ-1');
    expect(line.processId, 'у новой строки уже есть процесс').toBeNull();

    const { status, body } = await post(`/lines/${line.id}/process`, { processId: 'happy' });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.step).toBe(1);
    expect(body.status).toBe('new');

    const after = await processOf(line.id);
    expect(after.p).toBe('happy');
    expect(after.step).toBe(1);
  });

  test('ПОСЛЕ НАЗНАЧЕНИЯ СТРОКА ДВИГАЕТСЯ ПО УЗЛАМ', async () => {
    const line = await pasteLine('ПРОЦ-2');
    await post(`/lines/${line.id}/process`, { processId: 'happy' });

    await post(`/lines/${line.id}/mark`, { marked: true });
    const moved = await post('/lines/step', { dir: 'next' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.step).toBe(2);

    const after = await processOf(line.id);
    expect(after.step).toBe(2);
    expect(after.p).toBe('happy');
  });

  test('неизвестный процесс → 400 со списком процессов', async () => {
    const line = await pasteLine('ПРОЦ-3');
    const { status, body } = await post(`/lines/${line.id}/process`, { processId: 'нетакого' });
    expect(status).toBe(400);
    expect(body.code).toBe('bad_request');
    expect(String(body.message), 'отказ не называет доступные процессы').toContain('happy');
  });

  test('строку уже в процессе повторно не назначают', async () => {
    const line = await pasteLine('ПРОЦ-4');
    await post(`/lines/${line.id}/process`, { processId: 'happy' });

    const { status, body } = await post(`/lines/${line.id}/process`, { processId: 'stock' });
    expect(status).toBe(409);
    expect(body.code).toBe('already_in_process');
  });

  test('состояние не по первому шагу → 409 с объяснением', async () => {
    const line = await pasteLine('ПРОЦ-5');
    await pool.query(`update line set status = 'shipped' where id = $1`, [line.id]);

    const { status, body } = await post(`/lines/${line.id}/process`, { processId: 'happy' });
    expect(status).toBe(409);
    expect(body.code).toBe('status_mismatch');
    expect(String(body.message), 'не сказано, чего ждёт первый шаг').toContain('new');
  });

  test('право отдельное: кладовщик и механик назначить не могут', async () => {
    const line = await pasteLine('ПРОЦ-6');

    expect((await post(`/lines/${line.id}/process`, { processId: 'happy' }, store)).status).toBe(403);
    expect((await post(`/lines/{id}/process`.replace('{id}', line.id), { processId: 'happy' }, mechanic)).status)
      .toBe(403);
    expect((await post(`/lines/${line.id}/process`, { processId: 'happy' }, manager)).status).toBe(200);
  });

  test('назначение попадает в журнал', async () => {
    const line = await pasteLine('ПРОЦ-7');
    await post(`/lines/${line.id}/process`, { processId: 'happy' }, manager);

    const r = await pool.query<{ action: string; field: string; new_value: string; role: string }>(
      `select action, field, new_value, role from audit_log
        where entity = 'line' and entity_id = $1 and field = 'process_id'`, [line.id]);
    expect(r.rowCount, 'назначение не попало в журнал').toBe(1);
    expect(r.rows[0]!.new_value).toBe('happy');
    expect(r.rows[0]!.role).toBe('manager');
  });
});

describe('строки заказ-наряда сразу в процессе ремонта', () => {
  const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

  test('работа и запчасть наряда получают процесс car_repair_in', async () => {
    const order = await post('/work-orders', { carId: CAR });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const id = String(order.body.id);

    const labor = await post(`/work-orders/${id}/labor`, { name: 'Замена масла', normHours: '1' });
    expect(labor.status).toBe(201);

    const part = await post(`/work-orders/${id}/part`, {
      nomenclatureId: '77777777-7777-7777-7777-777777777702', quantity: '1',
    });
    expect(part.status).toBe(201);

    const rows = await pool.query<{ process_id: string | null; process_step: number | null }>(
      `select process_id, process_step from line where work_order_id = $1 order by id`, [id]);
    expect(rows.rowCount).toBe(2);
    for (const row of rows.rows) {
      expect(row.process_id, 'строка наряда не в процессе ремонта').toBe('car_repair_in');
      expect(row.process_step).toBe(1);
    }
  });
});
