import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: ремонт (G1–G9) — 6 операций.
//
// Работы и запчасти — обычные строки `line` со ссылкой `work_order_id`: у строки
// уже есть `service_type_id` и `norm_hours` из карты §4.2. Отдельная таблица работ,
// как в legacy `doc.work_order_labor`, не нужна. Тесты проверяют именно это —
// что различие работ и запчастей выражается ЗНАЧЕНИЯМИ полей, а не другой таблицей.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';

const json = async (url: string, init?: RequestInit) => {
  const r = await request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const get = (url: string) => json(url, { headers: { accept: 'application/json' } });

/** Открывает наряд и возвращает его идентификатор. */
async function openOrder(): Promise<string> {
  const { status, body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
  expect(status, JSON.stringify(body)).toBe(201);
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  // Сид car_repair_in уже содержит наряд: сбрасываем, чтобы список был чистым.
  await resetTo('happy');
  await pool.query(`delete from work_order`);
  await seedProcess('car_repair_in');
});

describe('POST /work-orders — открытие наряда (G1)', () => {
  test('открывает наряд с автомобилем', async () => {
    await pool.query(`delete from work_order`);
    const { status, body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });

    expect(status).toBe(201);
    expect(String(body.number)).toMatch(/^ЗН-\d{4}$/);

    const { body: card } = await get(`/work-orders/${String(body.id)}`);
    const header = card.header as { car_id: string; status: string };
    expect(header.car_id).toBe(CAR);
    expect(header.status).toBe('new');
  });

  test('неизвестный автомобиль → 400 с именем поля', async () => {
    const { status, body } = await post('/work-orders', {
      carId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('carId');
  });

  test('карточка показывает марку и VIN автомобиля', async () => {
    const id = await openOrder();
    const { body } = await get(`/work-orders/${id}`);
    const header = body.header as { car: string; vin: string };
    expect(header.vin).toBe('XTC210530M0123456');
    expect(header.car).toBeTruthy();
  });
});

describe('GET /work-orders — список', () => {
  test('сид car_repair_in виден в списке', async () => {
    const { status, body } = await get('/work-orders');
    expect(status).toBe(200);
    expect(body.total).toBe(1);
  });

  test('фильтр по состоянию', async () => {
    expect((await get('/work-orders?status=new')).body.total).toBe(1);
    expect((await get('/work-orders?status=closed')).body.total).toBe(0);
  });

  test('неизвестное состояние → 400 в формате Problem', async () => {
    const { status, body } = await get('/work-orders?status=нетакого');
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });
});

describe('работы в заказ-наряде', () => {
  test('работа добавляется и пересчитывает итог наряда', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Замена масла', normHours: '1.5', salePrice: '1500', serviceTypeId: SERVICE,
    });

    expect(status, JSON.stringify(body)).toBe(201);
    expect(Number(body.total)).toBe(2250); // 1.5 × 1500
  });

  test('работа отличается от запчасти наличием нормо-часов', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Диагностика', normHours: '0.5', salePrice: '800' });

    const { body } = await get(`/work-orders/${id}`);
    const labor = body.labor as { norm_hours: string }[];
    const parts = body.parts as unknown[];

    expect(labor.length, 'работа не попала в labor').toBe(1);
    expect(Number(labor[0]!.norm_hours)).toBe(0.5);
    expect(parts.length, 'работа не должна считаться запчастью').toBe(0);
  });

  test('несколько работ суммируются', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Работа 1', normHours: '1', salePrice: '1000' });
    const { body } = await post(`/work-orders/${id}/labor`, { name: 'Работа 2', normHours: '2', salePrice: '500' });

    expect(Number(body.total)).toBe(2000); // 1×1000 + 2×500
  });

  test('закрытый наряд не правится', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Поздняя работа', normHours: '1',
    });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Закрытый заказ-наряд');
  });

  test('несуществующий наряд → 404', async () => {
    const { status } = await post('/work-orders/00000000-0000-0000-0000-0000000000ff/labor', {
      name: 'Работа', normHours: '1',
    });
    expect(status).toBe(404);
  });
});

describe('состояние заказ-наряда', () => {
  test('наряд переводится в работу', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'in_work' });

    expect(status).toBe(200);
    expect(body.status).toBe('in_work');
  });

  test('закрытие переводит строки наряда в «Закрыт» (G9)', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Работа', normHours: '1', salePrice: '100' });

    const { body } = await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(body.status).toBe('closed');
    expect(body.lines).toBe(1);
  });

  test('переход из закрытого — причина на языке оператора', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'in_work' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('уже закрыт');
    expect(String(body.message), 'машинное имя просочилось').not.toContain('closed');
  });

  test('закрыть можно сразу из «Открыт» — работы не нужны', async () => {
    const id = await openOrder();
    const { status } = await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(status).toBe(200);
  });

  test('неизвестное состояние отвергается схемой', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'нетакого' });
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });
});

describe('отмена наряда', () => {
  test('отмена убирает наряд и его строки', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Работа', normHours: '1' });

    const before = Number((await get('/work-orders')).body.total);

    const { status, body } = await json(`/work-orders/${id}`, { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.released).toBe(1);

    expect((await get(`/work-orders/${id}`)).status).toBe(404);
    // Считаем УБЫЛЬ, а не абсолют: в базе остаётся наряд из сида car_repair_in.
    expect(Number((await get('/work-orders')).body.total)).toBe(before - 1);
  });

  test('закрытый наряд отменить нельзя', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const { status, body } = await json(`/work-orders/${id}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Закрытый заказ-наряд');
  });
});

// ЖУРНАЛ РЕМОНТА. Находка прогона месяца: 200 узлов механика и НОЛЬ записей в
// журнале — работа, запчасть и переход наряда не журналировались вовсе. Здесь
// проверяется, что каждое из трёх действий оставляет след и что отказ следа не оставляет.

const MECHANIC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04';
const OIL = '77777777-7777-7777-7777-777777777701';

/** Записи журнала по наряду: свежие первыми. */
async function journalOf(id: string): Promise<{
  action: string; field: string | null; role: string | null;
  old_value: string | null; new_value: string | null;
  details: Record<string, unknown>;
}[]> {
  const r = await pool.query<{
    action: string; field: string | null; role: string | null;
    old_value: string | null; new_value: string | null; details: Record<string, unknown>;
  }>(
    `select action, field, role, old_value, new_value, details
       from audit_log where entity = 'work_order' and entity_id = $1
      order by at desc, id desc`,
    [id],
  );
  return r.rows;
}

describe('журнал ремонта: работа, запчасть, переход', () => {
  test('добавление работы записывается на механика с исполнителем', async () => {
    const id = await openOrder();
    const { status } = await request(
      `/work-orders/${id}/labor`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Замена масла', normHours: '1.5', salePrice: '1500', executorId: MECHANIC,
        }),
      },
      'mechanic',
    );
    expect(status).toBe(201);

    const rows = await journalOf(id);
    const labor = rows.find((r) => r.field === 'labor');
    expect(labor, 'работа не попала в журнал').toBeTruthy();
    expect(labor!.action).toBe('update');
    expect(labor!.role, 'работа записана не на механика').toBe('mechanic');
    expect(labor!.new_value).toBe('Замена масла');
    expect(labor!.details.normHours).toBe('1.5');
    expect(labor!.details.executorId, 'исполнитель не сохранён в журнале').toBe(MECHANIC);
  });

  test('добавление запчасти записывается с количеством и ценами', async () => {
    const id = await openOrder();
    const { status } = await post(`/work-orders/${id}/part`, {
      nomenclatureId: OIL, quantity: '2', salePrice: '1800', costPrice: '1200',
    });
    expect(status).toBe(201);

    const part = (await journalOf(id)).find((r) => r.field === 'part');
    expect(part, 'запчасть не попала в журнал').toBeTruthy();
    expect(part!.details.quantity).toBe('2');
    expect(part!.details.costPrice).toBe('1200');
    expect(String(part!.details.lineId)).toHaveLength(36);
  });

  test('переход наряда записывается со старым и новым состоянием', async () => {
    const id = await openOrder();
    await request(
      `/work-orders/${id}/transition`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'in_work' }),
      },
      'mechanic',
    );

    const move = (await journalOf(id)).find((r) => r.action === 'transition');
    expect(move, 'переход не попал в журнал').toBeTruthy();
    expect(move!.old_value).toBe('new');
    expect(move!.new_value).toBe('in_work');
    expect(move!.role).toBe('mechanic');
  });

  test('отказ не оставляет записи: работа в закрытый наряд', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const before = (await journalOf(id)).length;
    const { status } = await post(`/work-orders/${id}/labor`, { name: 'Поздняя', normHours: '1' });
    expect(status).toBe(409);
    expect((await journalOf(id)).length, 'отказ попал в журнал').toBe(before);
  });

  test('история наряда читается отбором журнала по записи', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Работа', normHours: '1' });

    // Тот же отбор, что у экрана журнала: entity + entityId (src/audit-api.ts:99-100).
    const { status, body } = await get(`/audit?entity=work_order&entityId=${id}`);
    expect(status).toBe(200);
    expect(Number(body.total)).toBeGreaterThan(0);
  });
});

// ИСТОРИЯ НАРЯДА ОТДЕЛЬНЫМ АДРЕСОМ. Решение заказчика (20.11.2026): её видит
// администратор и механик, НО БЕЗ СЕБЕСТОИМОСТИ. Общий журнал `/audit` для этого не
// годится: он только у администратора и показывает закупочные цены.
describe('GET /work-orders/{id}/history — история без себестоимости', () => {
  /** Наряд с работой и запчастью: у запчасти в журнале есть себестоимость. */
  async function orderWithWorkAndPart(): Promise<string> {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, {
      name: 'Замена масла', normHours: '1.5', salePrice: '1500', executorId: MECHANIC,
    });
    await post(`/work-orders/${id}/part`, {
      nomenclatureId: OIL, quantity: '2', salePrice: '1800', costPrice: '1200',
    });
    return id;
  }

  const history = async (id: string, role: string) => {
    const r = await request(
      `/work-orders/${id}/history`,
      { headers: { accept: 'application/json' } },
      role,
    );
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  test('механик видит историю: работа, запчасть, исполнитель', async () => {
    const id = await orderWithWorkAndPart();
    const { status, body } = await history(id, 'mechanic');
    expect(status, JSON.stringify(body)).toBe(200);

    const items = body.items as { field: string | null; details: Record<string, unknown> }[];
    const labor = items.find((x) => x.field === 'labor');
    expect(labor, 'работы в истории нет').toBeTruthy();
    expect(labor!.details.normHours).toBe('1.5');
    expect(labor!.details.executorId).toBe(MECHANIC);

    const part = items.find((x) => x.field === 'part');
    expect(part, 'запчасти в истории нет').toBeTruthy();
    expect(part!.details.quantity).toBe('2');
  });

  test('СЕБЕСТОИМОСТЬ В ОТВЕТЕ ОТСУТСТВУЕТ', async () => {
    const id = await orderWithWorkAndPart();
    const r = await request(`/work-orders/${id}/history`, {
      headers: { accept: 'application/json' },
    }, 'mechanic');
    const text = await r.text();

    // 1200 — закупочная цена запчасти из журнала. Её в ответе быть не должно.
    expect(text, 'себестоимость утекла в историю').not.toContain('costPrice');
    expect(text, 'закупочная цена утекла в историю').not.toContain('1200');
    // А цена продажи и часы — остаются: это рабочие данные механика.
    expect(text).toContain('1800');
  });

  test('администратор видит историю', async () => {
    const id = await orderWithWorkAndPart();
    expect((await history(id, 'admin')).status).toBe(200);
  });

  test('менеджеру и кладовщику история наряда закрыта', async () => {
    const id = await orderWithWorkAndPart();
    expect((await history(id, 'manager')).status).toBe(403);
    expect((await history(id, 'storekeeper')).status).toBe(403);
  });

  test('история несуществующего наряда → 404', async () => {
    const { status, body } = await history('00000000-0000-0000-0000-0000000000ff', 'admin');
    expect(status).toBe(404);
    expect(body.code).toBe('not_found');
  });
});
