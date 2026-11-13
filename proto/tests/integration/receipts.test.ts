import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: приёмка и склад — 8 операций.
//
// Главная проверка: остаток НЕ хранится в строке, он вычисляется из движений.
// Поэтому «правки остатка» в API нет, а проведение приёмки СОЗДАЁТ движение —
// и остаток меняется как следствие, а не как отдельная запись.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
// Номенклатура строки happy: в сиде она не задана, ставим сами.
const NOM = '77777777-7777-7777-7777-777777777701';

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

const balanceOf = async (): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `select coalesce(sum(on_hand), 0)::text as n from stock_balance
      where nomenclature_id = $1 and warehouse_id = $2`,
    [NOM, WH],
  );
  return Number(r.rows[0]!.n);
};

/** Готовит строку к приёмке: номенклатура, статус «Заказан», отметка. */
async function prepareLine(): Promise<void> {
  await pool.query(
    `update line set status = 'ordered', nomenclature_id = $2, quantity = 3 where id = $1`,
    [HAPPY, NOM],
  );
  await mark(HAPPY);
}

/** Создаёт приёмку и возвращает её идентификатор. */
async function makeReceipt(): Promise<string> {
  await prepareLine();
  const { status, body } = await post('/receipts', {});
  expect(status, JSON.stringify(body)).toBe(201);
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('POST /receipts — создание приёмки (K1)', () => {
  test('создаёт приёмку, но НЕ меняет статус строки', async () => {
    const id = await makeReceipt();

    const { body } = await get(`/receipts/${id}`);
    expect((body.header as { posted: boolean }).posted).toBe(false);
    expect(await lineStatus(HAPPY), 'создание приёмки сдвинуло статус строки').toBe('ordered');
  });

  test('товар на склад НЕ поступает до проведения', async () => {
    const before = await balanceOf();
    await makeReceipt();
    expect(await balanceOf(), 'остаток изменился до проведения').toBe(before);
  });

  test('без годных строк → 409 с перечнем статусов', async () => {
    await pool.query(`update line set status = 'closed' where id = $1`, [HAPPY]);
    await mark(HAPPY);

    const { status, body } = await post('/receipts', {});
    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
    expect(String(body.message)).toContain('ordered');
    expect(String(body.message)).toContain('closed');
  });

  test('строка в in_transit тоже годится', async () => {
    await pool.query(`update line set status = 'in_transit' where id = $1`, [HAPPY]);
    await mark(HAPPY);
    expect((await post('/receipts', {})).status).toBe(201);
  });
});

describe('GET /receipts — список и карточка', () => {
  test('список пуст, пока приёмок нет', async () => {
    expect((await get('/receipts')).body.total).toBe(0);
  });

  test('карточка отдаёт строки и признак возможности проведения', async () => {
    const id = await makeReceipt();
    const { body } = await get(`/receipts/${id}`);

    expect((body.lines as unknown[]).length).toBe(1);
    expect(body.canPost).toBe(true);
  });

  test('фильтр по проведению', async () => {
    await makeReceipt();
    expect((await get('/receipts?posted=false')).body.total).toBe(1);
    expect((await get('/receipts?posted=true')).body.total).toBe(0);
  });

  test('несуществующая приёмка → 404', async () => {
    const { status } = await get('/receipts/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
  });
});

describe('POST /receipts/{id}/post — проведение (M12)', () => {
  test('создаёт движение склада и меняет остаток', async () => {
    const id = await makeReceipt();
    const before = await balanceOf();

    const { status, body } = await post(`/receipts/${id}/post`);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.posted).toBe(true);
    expect(body.moved, 'движение не создано').toBe(1);

    expect(await balanceOf(), 'остаток не изменился').toBe(before + 3);
  });

  test('строки переходят в «На склад»', async () => {
    const id = await makeReceipt();
    await post(`/receipts/${id}/post`);
    expect(await lineStatus(HAPPY)).toBe('to_stock');
  });

  test('повторное проведение → 409: остаток удвоился бы', async () => {
    const id = await makeReceipt();
    await post(`/receipts/${id}/post`);

    const { status, body } = await post(`/receipts/${id}/post`);
    expect(status).toBe(409);
    expect(body.code).toBe('already_posted');
    expect(String(body.message)).toContain('удвоило бы остаток');
  });

  test('после проведения строка размещается в ячейку (K2)', async () => {
    const id = await makeReceipt();
    await post(`/receipts/${id}/post`);

    const { status } = await post(`/lines/${HAPPY}/cell`, { cellId: CELL });
    expect(status).toBe(200);
  });
});

describe('отмена приёмки', () => {
  test('непроведённую можно отменить — строки возвращаются в «Заказан»', async () => {
    const id = await makeReceipt();
    const { status, body } = await json(`/receipts/${id}`, { method: 'DELETE' });

    expect(status).toBe(200);
    expect(body.released).toBe(1);
    expect(await lineStatus(HAPPY)).toBe('ordered');
  });

  test('проведённую отменить нельзя — остаток исказился бы', async () => {
    const id = await makeReceipt();
    await post(`/receipts/${id}/post`);

    const { status, body } = await json(`/receipts/${id}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('исказила бы остаток');
  });
});

describe('склад: остатки и движения', () => {
  test('остатки видны после проведения приёмки', async () => {
    const id = await makeReceipt();
    await post(`/receipts/${id}/post`);

    const { status, body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    expect(status).toBe(200);
    const items = body.items as { on_hand: string; available: string; nomenclature: string }[];
    expect(items.length).toBe(1);
    expect(Number(items[0]!.on_hand)).toBe(3);
    expect(Number(items[0]!.available), 'свободный остаток = остаток − резерв').toBe(3);
    expect(items[0]!.nomenclature).toBeTruthy();
  });

  test('резерв уменьшает свободный остаток, но не остаток', async () => {
    await pool.query(
      `insert into stock_move (nomenclature_id, warehouse_id, kind, quantity) values ($1, $2, 'receipt', 5)`,
      [NOM, WH],
    );
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'reserve', quantity: '2',
    });

    const { body } = await get(`/stock/balance?nomenclatureId=${NOM}`);
    const item = (body.items as { on_hand: string; reserved: string; available: string }[])[0]!;
    expect(Number(item.on_hand)).toBe(5);
    expect(Number(item.reserved)).toBe(2);
    expect(Number(item.available)).toBe(3);
  });

  test('ручное движение возвращает получившийся остаток', async () => {
    const { status, body } = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'receipt', quantity: '7',
      comment: 'Инвентаризация',
    });
    expect(status).toBe(201);
    expect(Number(body.onHand)).toBe(7);
  });

  test('движение по неизвестной номенклатуре → 400', async () => {
    const { status, body } = await post('/stock/moves', {
      nomenclatureId: '00000000-0000-0000-0000-0000000000ff',
      warehouseId: WH, kind: 'receipt', quantity: '1',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('nomenclatureId');
  });

  test('нечисловое или отрицательное количество → 400 с именем поля', async () => {
    for (const q of ['abc', '0', '-5']) {
      const { status, body } = await post('/stock/moves', {
        nomenclatureId: NOM, warehouseId: WH, kind: 'receipt', quantity: q,
      });
      expect(status, `количество «${q}» прошло`).toBe(400);
      expect(body.field).toBe('quantity');
    }
  });

  test('фильтр «только ненулевой остаток» отсекает пустые места', async () => {
    const all = await get('/stock/balance');
    const positive = await get('/stock/balance?onlyPositive=true');
    expect((positive.body.items as unknown[]).length)
      .toBeLessThanOrEqual((all.body.items as unknown[]).length);
  });
});
