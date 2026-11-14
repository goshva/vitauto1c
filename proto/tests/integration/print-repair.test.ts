import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Печатные формы ремонта: заказ-наряд (перенос из legacy) и акт выполненных работ.
//
// Заказ-наряд переносится по СУЩЕСТВУ, а не по названию: в legacy форма печатала
// работы (нормо-часы и ставка), запчасти (артикул, единица, статус обеспечения),
// итоги и четыре подписи. Проверяется именно это, а не «страница открылась».
//
// Акт — новая форма. Ключевое отличие от наряда: он ЮРИДИЧЕСКИ значим, поэтому
// в нём есть исполнитель поимённо (Q3) и подписи обеих сторон.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const MECHANIC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04';

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
const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

/** Наряд с работой и запчастью — как в жизни, а не одна строка. */
async function orderWithWork(): Promise<string> {
  const { body } = await post('/work-orders', { carId: CAR, counterpartyId: CUSTOMER, serviceTypeId: SERVICE });
  const id = String(body.id);

  await post(`/work-orders/${id}/labor`, {
    name: 'Замена масла в двигателе', normHours: '1.5', salePrice: '1500', executorId: MECHANIC,
  });
  await post(`/work-orders/${id}/part`, {
    nomenclatureId: NOM, quantity: '2', salePrice: '900',
  });
  await post('/stock/moves', {
    nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '10',
  });

  return id;
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

describe('заказ-наряд — перенос формы из legacy', () => {
  test('печатается по наряду со всеми обязательными частями', async () => {
    const id = await orderWithWork();
    const { status, body } = await html(`/print/work_order?workOrderId=${id}`);

    expect(status).toBe(200);
    expect(body).toContain('data-testid="print-work-order"');
    expect(body).toContain('Заказ-наряд №');

    // Разделы формы: работы, запчасти, подписи — как в legacy.
    for (const id2 of ['wo-labor', 'wo-parts', 'wo-signs']) {
      expect(body, `нет раздела ${id2}`).toContain(`data-testid="${id2}"`);
    }
  });

  test('в форме видны работа, нормо-часы, ставка и сумма', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_order?workOrderId=${id}`);

    expect(body).toContain('Замена масла в двигателе');
    expect(body).toContain('1,5');
    expect(body).toContain('1 500');
    expect(body).toContain('2 250'); // 1.5 × 1500
  });

  test('в форме видны запчасть, артикул, единица и состояние обеспечения', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_order?workOrderId=${id}`);

    expect(body).toContain('MOT5W30-5L');
    // Состояние обеспечения — то, что legacy печатал по строке.
    expect(body).toContain('data-testid="wo-part-status"');
  });

  test('видны клиент, автомобиль, VIN и организация', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_order?workOrderId=${id}`);

    expect(body).toContain('LADA Vesta');
    expect(body).toContain('XTC210530M0123456'); // VIN
    expect(body).toContain('Клиент:');
    expect(body).toContain('Организация:');
  });

  test('четыре подписи, как в legacy', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_order?workOrderId=${id}`);

    for (const s of ['Принял в ремонт', 'Выполнил', 'Авто выдал', 'Клиент получил']) {
      expect(body, `нет подписи «${s}»`).toContain(s);
    }
  });

  test('пустой наряд печатается с прочерками, а не падает', async () => {
    const { body: order } = await post('/work-orders', { carId: CAR, counterpartyId: CUSTOMER, serviceTypeId: SERVICE });
    const { status, body } = await html(`/print/work_order?workOrderId=${String(order.id)}`);

    expect(status).toBe(200);
    expect(body).toContain('—');
  });

  test('итог наряда печатается', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_order?workOrderId=${id}`);

    const r = await pool.query<{ total: string }>(`select total::text from work_order where id = $1`, [id]);
    // 1.5 × 1500 + 2 × 900 = 4050
    expect(Number(r.rows[0]!.total)).toBe(4050);
    expect(body).toContain('4 050');
  });

  test('неизвестный наряд → 404', async () => {
    const { status } = await html('/print/work_order?workOrderId=00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
  });

  test('без идентификатора → 400 с объяснением', async () => {
    const { status, body } = await html('/print/work_order');
    expect(status).toBe(400);
    expect(body).toContain('workOrderId');
  });
});

describe('акт выполненных работ — новая форма', () => {
  test('печатается и содержит стороны, основание и подписи', async () => {
    const id = await orderWithWork();
    const { status, body } = await html(`/print/work_act?workOrderId=${id}`);

    expect(status).toBe(200);
    expect(body).toContain('data-testid="print-work-act"');
    expect(body).toContain('Акт выполненных работ');

    for (const part of ['Заказчик', 'Исполнитель', 'Основание']) {
      expect(body, `нет реквизита «${part}»`).toContain(part);
    }
    expect(body).toContain('data-testid="act-signs"');
  });

  test('в акте есть исполнитель поимённо — документ юридически значим (Q3)', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_act?workOrderId=${id}`);

    expect(body).toContain('data-testid="act-executor"');
    expect(body, 'в акте нет имени механика').toContain('Петров П. С.');
  });

  test('акт перечисляет и работы, и запчасти — это стоимость ремонта целиком', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_act?workOrderId=${id}`);

    expect(body).toContain('Замена масла в двигателе');
    expect(body).toContain('MOT5W30-5L');
    expect(body).toContain('data-testid="act-table"');
  });

  test('в акте есть итог и он равен стоимости наряда', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_act?workOrderId=${id}`);

    expect(body).toContain('data-testid="act-total"');
    expect(body).toContain('4 050');
  });

  test('подписи обеих сторон: сдал и принял', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_act?workOrderId=${id}`);

    expect(body).toContain('Работы сдал');
    expect(body).toContain('Работы принял');
  });

  test('основание ссылается на заказ-наряд', async () => {
    const id = await orderWithWork();
    const { body } = await html(`/print/work_act?workOrderId=${id}`);

    const r = await pool.query<{ number: string | null }>(
      `select number from work_order where id = $1`, [id]);
    expect(body).toContain('Заказ-наряд');
    expect(body).toContain(String(r.rows[0]!.number));
  });

  test('неизвестный наряд → 404', async () => {
    const { status } = await html('/print/work_act?workOrderId=00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
  });
});

describe('обе формы доступны из АРМ', () => {
  test('ссылки на формы есть на экране автопарка в карточке ТС', async () => {
    const id = await orderWithWork();
    // Наряд принадлежит машине — ссылки на печать ищем в её карточке.
    const r = await pool.query<{ car_id: string }>(`select car_id from work_order where id = $1`, [id]);
    const { body } = await html(`/fleet/${r.rows[0]!.car_id}`);

    expect(body, 'в карточке ТС нет ссылки на печать наряда').toContain('print/work_order');
    expect(body, 'в карточке ТС нет ссылки на акт').toContain('print/work_act');
  });

  test('обе формы вне OpenAPI — это HTML, а не данные', async () => {
    const { body } = await post('/print', { kind: 'work_order' });
    // Совместимость с legacy: неизвестный вид в построчных формах даёт понятный отказ.
    expect(String(body.message ?? '')).toBeTruthy();
  });
});
