import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 4: неопознанные позиции (A1 «создать в папке», K8 «розыск позиции»).
//
// Признак неопознанной позиции — ОТСУТСТВИЕ номенклатуры, а не зона: позиция может
// лежать не в своей зоне, и терять её из-за этого нельзя. Тесты это проверяют.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const NOM = '77777777-7777-7777-7777-777777777701';
const ZONE_UNK = '99999999-9999-9999-9999-999999999904';
const ZONE_SM = '99999999-9999-9999-9999-999999999902';

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

const lineOf = async (id: string) => {
  const r = await pool.query<{ n: string | null; z: string | null; c: string | null }>(
    `select nomenclature_id::text n, zone_id::text z, cell_id::text c from line where id = $1`, [id],
  );
  return r.rows[0]!;
};

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /unidentified — список ждущих опознания', () => {
  test('строка без номенклатуры попадает в список', async () => {
    // Строка happy заведена без номенклатуры — она и есть неопознанная.
    const { status, body } = await get('/unidentified');
    expect(status).toBe(200);

    const items = body.items as { id: string; fact_name: string | null }[];
    expect(items.some((x) => x.id === HAPPY)).toBe(true);
    expect(items.find((x) => x.id === HAPPY)!.fact_name).toBeTruthy();
  });

  test('строка С номенклатурой в список не попадает', async () => {
    await pool.query(`update line set nomenclature_id = $2 where id = $1`, [HAPPY, NOM]);
    const { body } = await get('/unidentified');
    expect((body.items as { id: string }[]).some((x) => x.id === HAPPY)).toBe(false);
  });

  test('удалённая строка не попадает', async () => {
    await pool.query(`update line set deleted = true where id = $1`, [HAPPY]);
    const { body } = await get('/unidentified');
    expect(body.total).toBe(0);
  });
});

describe('A1 — отправить в неопознанные', () => {
  test('перемещает строку в зону неопознанных с ячейкой', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/unidentified`, {
      comment: 'Пришло не то, фото 3',
    });

    expect(status).toBe(200);
    expect(body.zone).toBe('UNK');
    expect(body.cell).toBeTruthy();

    const at = await lineOf(HAPPY);
    expect(at.z).toBe(ZONE_UNK);
    expect(at.c).toBeTruthy();
  });

  test('комментарий сохраняется — по нему потом ищут', async () => {
    await post(`/lines/${HAPPY}/unidentified`, { comment: 'Похоже на фильтр, фото 3' });
    const r = await pool.query<{ comment: string }>(`select comment from line where id = $1`, [HAPPY]);
    expect(r.rows[0]!.comment).toBe('Похоже на фильтр, фото 3');
  });

  test('опознанную позицию отправлять в неопознанные незачем', async () => {
    await pool.query(`update line set nomenclature_id = $2 where id = $1`, [HAPPY, NOM]);
    const { status, body } = await post(`/lines/${HAPPY}/unidentified`, {});

    expect(status).toBe(409);
    expect(body.code).toBe('already_identified');
  });

  test('несуществующая строка → 404', async () => {
    const { status } = await post('/lines/00000000-0000-0000-0000-0000000000ff/unidentified', {});
    expect(status).toBe(404);
  });
});

describe('K8 — розыск позиции', () => {
  test('сопоставление с номенклатурой убирает позицию из списка', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/bind`, { nomenclatureId: NOM });

    expect(status).toBe(200);
    expect(String(body.nomenclature)).toContain('Масло');

    const at = await lineOf(HAPPY);
    expect(at.n).toBe(NOM);

    const list = await get('/unidentified');
    expect((list.body.items as { id: string }[]).some((x) => x.id === HAPPY)).toBe(false);
  });

  test('после опознания позицию кладут на склад — зона задаётся явно', async () => {
    const { body } = await post(`/lines/${HAPPY}/bind`, { nomenclatureId: NOM, zoneId: ZONE_SM });

    expect(body.zone).toBe('SM');
    expect(body.cell).toBeTruthy();

    const at = await lineOf(HAPPY);
    expect(at.z, 'позиция осталась в зоне неопознанных').toBe(ZONE_SM);
  });

  test('без зоны позиция остаётся где лежала — это решение кладовщика', async () => {
    await post(`/lines/${HAPPY}/unidentified`, {});
    const before = await lineOf(HAPPY);

    await post(`/lines/${HAPPY}/bind`, { nomenclatureId: NOM });
    const after = await lineOf(HAPPY);

    expect(after.z).toBe(before.z);
    expect(after.c).toBe(before.c);
  });

  test('повторное сопоставление отвергается: оно переписало бы историю', async () => {
    await post(`/lines/${HAPPY}/bind`, { nomenclatureId: NOM });
    const { status, body } = await post(`/lines/${HAPPY}/bind`, {
      nomenclatureId: '77777777-7777-7777-7777-777777777702',
    });

    expect(status).toBe(409);
    expect(body.code).toBe('already_identified');

    const at = await lineOf(HAPPY);
    expect(at.n, 'номенклатура подменилась').toBe(NOM);
  });

  test('неизвестная номенклатура → 400 с именем поля', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/bind`, {
      nomenclatureId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('nomenclatureId');
  });

  test('несуществующая строка → 404', async () => {
    const { status } = await post('/lines/00000000-0000-0000-0000-0000000000ff/bind', {
      nomenclatureId: NOM,
    });
    expect(status).toBe(404);
  });
});
