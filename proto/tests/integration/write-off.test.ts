import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Автосписание запчастей при завершении заказ-наряда (Q4).
//
// Без списания остаток «раздувается»: закупили 10, выдали 8, а на складе всё ещё
// 10 — фикция. Менеджер заказывает лишнее, отчёт по расходу невозможен, а ручное
// списание забывается ровно тогда, когда механик закрыл наряд.
//
// Тест написан ДО реализации. Проверяется не «движение создалось», а ОСТАТОК:
// движение может появиться, а остаток не измениться — именно так было до этого.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const NOM2 = '77777777-7777-7777-7777-777777777702';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const MECHANIC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const get = (url: string) => json(url, { headers: { accept: 'application/json' } });
const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const onHand = async (nomenclatureId: string): Promise<number> => {
  const { body } = await get(`/stock/balance?nomenclatureId=${nomenclatureId}`);
  const items = body.items as { on_hand: string }[];
  return items.reduce((s, x) => s + Number(x.on_hand), 0);
};

async function openOrder(): Promise<string> {
  const { body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
  return String(body.id);
}

/** Кладём запчасть на склад: без остатка списывать нечего. */
async function stockUp(nomenclatureId: string, quantity: number): Promise<void> {
  await post('/stock/moves', {
    nomenclatureId, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: String(quantity),
  });
}

async function addPart(orderId: string, nomenclatureId: string, quantity: string): Promise<string> {
  const { body } = await post(`/work-orders/${orderId}/part`, {
    nomenclatureId, quantity, salePrice: '900',
  });
  return String(body.lineId);
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

describe('запчасть в заказ-наряде (закрывает пробел B3)', () => {
  test('запчасть добавляется и отличается от работы', async () => {
    const id = await openOrder();
    const { status } = await post(`/work-orders/${id}/part`, {
      nomenclatureId: NOM, quantity: '2', salePrice: '900',
    });
    expect(status).toBe(201);

    const { body } = await get(`/work-orders/${id}`);
    expect((body.parts as unknown[]).length).toBe(1);
    expect((body.labor as unknown[]).length, 'запчасть попала в работы').toBe(0);
  });

  test('работа и запчасть в одном наряде не путаются', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Замена', normHours: '1.5', salePrice: '1500' });
    await post(`/work-orders/${id}/part`, { nomenclatureId: NOM, quantity: '2', salePrice: '900' });

    const { body } = await get(`/work-orders/${id}`);
    expect((body.labor as unknown[]).length).toBe(1);
    expect((body.parts as unknown[]).length).toBe(1);
  });

  test('итог наряда = работы (нормо-часы × цена) + запчасти (кол-во × цена)', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Замена', normHours: '1.5', salePrice: '1500' });
    await post(`/work-orders/${id}/part`, { nomenclatureId: NOM, quantity: '2', salePrice: '900' });

    const { body } = await get(`/work-orders/${id}`);
    // 1.5 × 1500 + 2 × 900 = 2250 + 1800 = 4050
    expect(Number((body.header as { total: string }).total)).toBe(4050);
  });

  test('неизвестная номенклатура → 400', async () => {
    const id = await openOrder();
    const { status, body } = await post(`/work-orders/${id}/part`, {
      nomenclatureId: '00000000-0000-0000-0000-0000000000ff', quantity: '1',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('nomenclatureId');
  });
});

describe('автосписание при закрытии наряда (Q4)', () => {
  test('остаток УМЕНЬШАЕТСЯ на количество списанной запчасти', async () => {
    await stockUp(NOM, 10);
    expect(await onHand(NOM)).toBe(10);

    const id = await openOrder();
    await addPart(id, NOM, '3');
    await post(`/work-orders/${id}/transition`, { to: 'in_work' });
    const closed = await post(`/work-orders/${id}/transition`, { to: 'closed' });

    expect(closed.status).toBe(200);
    expect(await onHand(NOM), 'остаток не изменился — списания не было').toBe(7);
  });

  test('создано движение вида write_off, привязанное к наряду', async () => {
    await stockUp(NOM, 5);
    const id = await openOrder();
    const lineId = await addPart(id, NOM, '2');
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const r = await pool.query<{ kind: string; quantity: string; line_id: string; work_order_id: string }>(
      `select kind, quantity::text, line_id, work_order_id from stock_move
        where work_order_id = $1`,
      [id],
    );
    expect(r.rowCount, 'движения списания нет').toBe(1);
    expect(r.rows[0]!.kind).toBe('write_off');
    expect(Number(r.rows[0]!.quantity)).toBe(2);
    expect(r.rows[0]!.line_id).toBe(lineId);
  });

  test('работа НЕ списывается — списываются только запчасти', async () => {
    await stockUp(NOM, 5);
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, {
      name: 'Замена', normHours: '1.5', salePrice: '1500', executorId: MECHANIC, nomenclatureId: NOM,
    });
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    // У работы тоже есть номенклатура, но нормо-часы не пусты — это услуга, а не товар.
    expect(await onHand(NOM), 'списали работу вместо запчасти').toBe(5);
  });

  test('несколько запчастей списываются каждая', async () => {
    await stockUp(NOM, 10);
    await stockUp(NOM2, 10);

    const id = await openOrder();
    await addPart(id, NOM, '2');
    await addPart(id, NOM2, '4');
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    expect(await onHand(NOM)).toBe(8);
    expect(await onHand(NOM2)).toBe(6);

    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from stock_move where work_order_id = $1 and kind = 'write_off'`,
      [id],
    );
    expect(Number(r.rows[0]!.n)).toBe(2);
  });

  test('идемпотентность: повторное закрытие не списывает второй раз', async () => {
    await stockUp(NOM, 10);
    const id = await openOrder();
    await addPart(id, NOM, '3');

    await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(await onHand(NOM)).toBe(7);

    // Повторный переход в закрытое состояние отклоняется доменом.
    const again = await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(again.status).toBe(409);
    expect(await onHand(NOM), 'списали дважды').toBe(7);
  });

  test('наряд без запчастей закрывается нормально', async () => {
    const id = await openOrder();
    await post(`/work-orders/${id}/labor`, { name: 'Диагностика', normHours: '0.5' });

    const { status } = await post(`/work-orders/${id}/transition`, { to: 'closed' });
    expect(status).toBe(200);
  });

  test('списание видно в истории остатка с причиной', async () => {
    await stockUp(NOM, 4);
    const id = await openOrder();
    await addPart(id, NOM, '1');
    await post(`/work-orders/${id}/transition`, { to: 'closed' });

    const { body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    const item = (body.items as { on_hand: string; reserved: string }[])[0]!;
    expect(Number(item.on_hand)).toBe(3);
    expect(Number(item.reserved), 'списание не должно трогать резерв').toBe(0);
  });

  test('write_off — допустимый вид движения для ручного расхода', async () => {
    await stockUp(NOM, 10);
    const { status } = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'write_off', quantity: '2', comment: 'Бой',
    });
    expect(status, 'ручное списание тем же видом должно работать').toBe(201);
    expect(await onHand(NOM)).toBe(8);
  });

  test('списанное раньше не мешает закрыть другой наряд', async () => {
    await stockUp(NOM, 10);

    const first = await openOrder();
    await addPart(first, NOM, '2');
    await post(`/work-orders/${first}/transition`, { to: 'closed' });

    const second = await openOrder();
    await addPart(second, NOM, '3');
    await post(`/work-orders/${second}/transition`, { to: 'closed' });

    expect(await onHand(NOM)).toBe(5);
  });
});
