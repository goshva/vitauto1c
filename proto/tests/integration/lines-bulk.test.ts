import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: группа «Строки» — свод, массовая правка, удаление, экспорт (6 операций).
//
// Отдельно проверяется порядок монтирования: `/lines/summary` обязан попадать
// в свой обработчик, а не в `/lines/{id}` с проверкой UUID. Это неочевидная
// ловушка Hono: маршруты сопоставляются в порядке регистрации.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const STOCK = 'b0000000-0000-0000-0000-000000000002';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  const type = r.headers.get('content-type') ?? '';
  if (type.includes('json')) return { status: r.status, body: (await r.json()) as Record<string, unknown>, text: '' };
  return { status: r.status, body: {} as Record<string, unknown>, text: await r.text() };
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

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /lines/summary — свод по статусам', () => {
  test('свод считается из строк и группируется по статусу', async () => {
    const { status, body } = await get('/lines/summary');
    expect(status, 'попали в /lines/{id} вместо свода').toBe(200);

    const byStatus = body.byStatus as { status: string; lines: number }[];
    const total = body.total as { lines: number };
    expect(total.lines, 'всего строк не сходится').toBe(2);
    expect(byStatus.find((s) => s.status === 'new')?.lines).toBe(2);
  });

  test('свод пересчитывается после смены статуса', async () => {
    await pool.query(`update line set status = 'reserve' where id = $1`, [HAPPY]);
    const { body } = await get('/lines/summary');
    const byStatus = body.byStatus as { status: string; lines: number }[];

    expect(byStatus.find((s) => s.status === 'new')?.lines).toBe(1);
    expect(byStatus.find((s) => s.status === 'reserve')?.lines).toBe(1);
  });

  test('суммы считаются из количества и цены', async () => {
    await pool.query(`update line set quantity = 2, sale_price = 500 where id = $1`, [HAPPY]);
    const { body } = await get('/lines/summary');
    const total = body.total as { saleSum: string };
    expect(Number(total.saleSum)).toBe(1000);
  });

  test('закупки считаются отдельно от продаж', async () => {
    const sales = await get('/lines/summary?view=sales');
    const purchases = await get('/lines/summary?view=purchases');
    expect((sales.body.total as { lines: number }).lines).toBe(2);
    expect((purchases.body.total as { lines: number }).lines).toBe(0);
  });
});

describe('POST /lines/bulk-field — массовая правка', () => {
  test('проставляет поле у отмеченных строк', async () => {
    await mark(HAPPY);
    await mark(STOCK);

    const { status, body } = await post('/lines/bulk-field', {
      field: 'comment', value: 'Проверено кладовщиком',
    });
    expect(status).toBe(200);
    expect(body.updated).toBe(2);

    const r = await pool.query<{ comment: string }>(`select comment from line where id = $1`, [HAPPY]);
    expect(r.rows[0]!.comment).toBe('Проверено кладовщиком');
  });

  test('после массовой правки отметки снимаются', async () => {
    await mark(HAPPY);
    await post('/lines/bulk-field', { field: 'comment', value: 'x' });

    const n = await pool.query(`select 1 from line_mark where marked`);
    expect(n.rowCount, 'отметки остались — следующее действие задело бы те же строки').toBe(0);
  });

  test('массово правится только разрешённый список полей', async () => {
    await mark(HAPPY);
    for (const field of ['quantity', 'sale_price', 'status']) {
      const { status, body } = await post('/lines/bulk-field', { field, value: 1 });
      expect(status, `поле «${field}» прошло массовую правку`).toBe(400);
      expect(body.field).toBe(field);
    }
  });

  test('без отмеченных строк → 409', async () => {
    const { status, body } = await post('/lines/bulk-field', { field: 'comment', value: 'x' });
    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
  });
});

describe('удаление и восстановление строки', () => {
  test('строку в «Новый» можно удалить и восстановить', async () => {
    const del = await json(`/lines/${HAPPY}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const hidden = await pool.query(`select 1 from line_view where "id" = $1`, [HAPPY]);
    expect(hidden.rowCount, 'удалённая строка видна в списке').toBe(0);

    const back = await post(`/lines/${HAPPY}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('new');
  });

  test('восстановление неудалённой строки → 404', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/restore`);
    expect(status).toBe(404);
    expect(String(body.message)).toContain('не удалена');
  });

  test('отгруженную строку удалить нельзя — перечень статусов в тексте', async () => {
    await pool.query(`update line set status = 'shipped' where id = $1`, [HAPPY]);

    const { status, body } = await json(`/lines/${HAPPY}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('shipped');
    expect(String(body.message)).toContain('new');
    expect(await lineStatus(HAPPY), 'статус не должен измениться').toBe('shipped');
  });

  test('удалённая строка не удаляется повторно', async () => {
    await json(`/lines/${HAPPY}`, { method: 'DELETE' });
    expect((await json(`/lines/${HAPPY}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('POST /lines/bulk-delete — массовое удаление', () => {
  test('удаляет годные строки и перечисляет пропущенные', async () => {
    await pool.query(`update line set status = 'shipped' where id = $1`, [HAPPY]);
    await mark(HAPPY);
    await mark(STOCK);

    const { status, body } = await post('/lines/bulk-delete');
    expect(status).toBe(200);
    expect(body.deleted, 'удалилась не та строка').toBe(1);

    const skipped = body.skipped as string[];
    expect(skipped.length).toBe(1);
    expect(skipped[0]).toContain('удаление недоступно');
  });

  test('без отметок → 409', async () => {
    const { status, body } = await post('/lines/bulk-delete');
    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
  });
});

describe('GET /lines/export — выгрузка CSV', () => {
  test('отдаётся как CSV с BOM и точкой с запятой', async () => {
    const { status, text } = await get('/lines/export');
    expect(status).toBe(200);
    // BOM: без него Excel в русской локали ломает кириллицу.
    expect(text.charCodeAt(0), 'нет BOM — Excel испортит кириллицу').toBe(0xfeff);
    expect(text.split('\r\n')[0]).toContain(';');
    expect(text).toContain('Фильтр масляный');
  });

  test('значения с разделителем экранируются кавычками', async () => {
    await pool.query(`update line_fact set fact_name = $2 where id = $1`, [
      HAPPY, 'Фильтр; "масляный"',
    ]);
    const { text } = await get('/lines/export');

    // Точка с запятой внутри значения обязана быть в кавычках, а кавычка — удвоена.
    expect(text).toContain('"Фильтр; ""масляный"""');
  });

  test('первая строка — заголовки колонок', async () => {
    const { text } = await get('/lines/export');
    const header = text.replace('\uFEFF', '').split('\r\n')[0]!;
    expect(header).toContain('status');
    expect(header).toContain('factName');
  });
});
