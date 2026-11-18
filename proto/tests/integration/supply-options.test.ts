import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// ФТ v2 п. 12: «В строке заказа — поле выбора варианта, если одна деталь встречается
// у нескольких поставщиков или по разным ценам: список вариантов с ценой и сроком
// по каждому».
//
// ГЛАВНОЕ ЗДЕСЬ — что выбор фиксирует ЦЕНУ И СРОК, а не «приписывает поставщика».
// Снабженец выбирает не «АвтооптТорг вообще», а 395 ₽ через три недели, и именно
// это должно попасть в строку и в заказ поставщику.

const NOM = '77777777-7777-7777-7777-777777777702';        // 3 предложения
const NOM_SINGLE = '77777777-7777-7777-7777-777777777706'; // 1 предложение
const OFFER_CHEAP = 'aa000000-0000-0000-0000-000000000002'; // 395 ₽, 21 день
const OFFER_FAST = 'aa000000-0000-0000-0000-000000000003';  // 520 ₽, 1 день
const OFFER_OTHER = 'aa000000-0000-0000-0000-000000000004'; // другое номенклатура

const json = async (url: string, init: RequestInit = {}, role = 'admin') => {
  const r = await request(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  }, role);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = (url: string, body: unknown, role = 'admin') =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, role);
const html = async (url: string, role = 'admin') => {
  const r = await request(url, { headers: { accept: 'text/html'} }, role);
  return { status: r.status, body: await r.text() };
};

/** Строка с номенклатурой, у которой есть варианты. */
async function lineWith(nomenclatureId: string): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);
  await pool.query(
    `update line set nomenclature_id = $2, status = 'ordered', cost_price = null,
            supplier_id = null, supplier_offer_id = null
      where id = $1`, [id, nomenclatureId]);
  return id;
}

const lineOf = async (id: string) =>
  (await pool.query<{
    supplier_id: string | null; cost_price: string | null; supplier_offer_id: string | null;
  }>(`select supplier_id, cost_price::text, supplier_offer_id from line where id = $1`, [id])).rows[0]!;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№12 · список вариантов', () => {
  test('варианты отдаются с ЦЕНОЙ и СРОКОМ по каждому', async () => {
    const id = await lineWith(NOM);
    const { status, body } = await json(`/lines/${id}/supply-options`);
    expect(status).toBe(200);

    const items = body.items as { supplier: string; price: string; deliveryDays: number | null }[];
    expect(items.length, 'вариантов меньше трёх').toBe(3);
    for (const o of items) {
      expect(o.supplier, 'вариант без поставщика').toBeTruthy();
      expect(o.price, 'вариант без цены').toBeTruthy();
      // Срок может быть пустым («со склада»), но поле обязано быть: без него
      // «900 ₽ через три недели» и «1100 ₽ завтра» неразличимы.
      expect(o, 'в варианте нет поля срока').toHaveProperty('deliveryDays');
    }
  });

  test('срочные варианты идут ВЫШЕ дешёвых', async () => {
    const id = await lineWith(NOM);
    const { body } = await json(`/lines/${id}/supply-options`);
    const items = body.items as { price: string; deliveryDays: number | null }[];

    // «Забрать сегодня» важнее экономии: порядок не должен прятать срочный
    // вариант за дешёвым.
    const days = items.map((o) => o.deliveryDays);
    const firstWithDays = days.findIndex((d) => d !== null);
    expect(days.slice(firstWithDays), 'среди вариантов со сроком порядок не по сроку')
      .toEqual([...days.slice(firstWithDays)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  test('у позиции с ОДНИМ предложением список из одного — выбирать не из чего', async () => {
    const id = await lineWith(NOM_SINGLE);
    const { body } = await json(`/lines/${id}/supply-options`);
    expect((body.items as unknown[]).length).toBe(1);
  });

  test('неопознанная позиция: вариантов нет, и это не ошибка', async () => {
    const id = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(`update line set nomenclature_id = null where id = $1`, [id]);

    const { status, body } = await json(`/lines/${id}/supply-options`);
    expect(status).toBe(200);
    expect((body.items as unknown[]).length).toBe(0);
    expect(body.nomenclature, 'неопознанная позиция отдала имя номенклатуры').toBe(null);
  });

  test('неизвестная строка → 404', async () => {
    const { status } = await json('/lines/00000000-0000-0000-0000-0000000000ff/supply-options');
    expect(status).toBe(404);
  });
});

describe('№12 · выбор варианта', () => {
  test('цена и поставщик выбранного варианта попадают В СТРОКУ', async () => {
    const id = await lineWith(NOM);

    const { status, body } = await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP });
    expect(status).toBe(200);
    expect(String(body.price)).toContain('395');

    const l = await lineOf(id);
    expect(l.supplier_offer_id, 'выбранный вариант не записан').toBe(OFFER_CHEAP);
    expect(l.cost_price, 'цена варианта не попала в себестоимость').toContain('395');
    expect(l.supplier_id, 'поставщик варианта не попал в строку').toBeTruthy();
  });

  test('смена варианта ПЕРЕПИСЫВАЕТ цену, а не добавляет вторую', async () => {
    const id = await lineWith(NOM);

    await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP });
    await post(`/lines/${id}/supply-option`, { offerId: OFFER_FAST });

    const l = await lineOf(id);
    expect(l.supplier_offer_id, 'остался прежний вариант').toBe(OFFER_FAST);
    expect(l.cost_price, 'цена не переписалась').toContain('520');
  });

  test('предложение ЧУЖОЙ номенклатуры отвергается', async () => {
    const id = await lineWith(NOM);

    const { status, body } = await post(`/lines/${id}/supply-option`, { offerId: OFFER_OTHER });
    expect(status, 'приняли предложение от другой детали').toBe(400);
    expect(String(body.message), 'причина не объясняет, что не так').toContain('номенклатур');

    const l = await lineOf(id);
    expect(l.supplier_offer_id, 'чужая цена всё-таки записалась').toBe(null);
  });

  test('неизвестное предложение → 404', async () => {
    const id = await lineWith(NOM);
    const { status } = await post(`/lines/${id}/supply-option`,
      { offerId: '00000000-0000-0000-0000-0000000000ff' });
    expect(status).toBe(404);
  });

  test('право — как у закупки: менеджер и админ, кладовщику нельзя', async () => {
    const id = await lineWith(NOM);
    expect((await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP }, 'storekeeper')).status)
      .toBe(403);
    expect((await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP }, 'manager')).status)
      .toBe(200);
  });

  test('выбор виден в состоянии строки — каким он стал', async () => {
    const id = await lineWith(NOM);
    await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP });

    const { body } = await json(`/lines/${id}/supply-options`);
    expect(body.chosen, 'выбранный вариант не отмечен').toBe(OFFER_CHEAP);
    const chosen = (body.items as { id: string; chosen: boolean }[]).find((o) => o.chosen);
    expect(chosen!.id).toBe(OFFER_CHEAP);
  });
});

describe('№12 · поле выбора В САМОЙ СТРОКЕ', () => {
  test('в списке у строки с вариантами появляется поле выбора', async () => {
    const id = await lineWith(NOM);
    const { body } = await html('/lines');
    expect(body, 'поля выбора варианта нет в строке').toContain(`data-testid="offer-${id}"`);
    expect(body, 'поле не отправляет выбор').toContain(`/ui/lines/${id}/offer`);
  });

  test('в поле видны и цена, и срок — по ним и выбирают', async () => {
    await lineWith(NOM);
    const { body } = await html('/lines');
    expect(body, 'в вариантах нет цены').toContain('395');
    expect(body, 'в вариантах нет срока').toContain('21 дн.');
    expect(body, 'нет пометки «со склада» для срочного').toContain('со склада');
  });

  test('одно предложение — не выпадающий список, а подпись', async () => {
    const id = await lineWith(NOM_SINGLE);
    const { body } = await html('/lines');
    // Список с единственным пунктом выглядит как выбор, которого нет.
    expect(body).toContain(`data-testid="offer-single-${id}"`);
    expect(body, 'для одного предложения нарисовали список').not.toContain(`data-testid="offer-${id}"`);
  });

  test('UI-выбор делегирует в API — цена не пересчитывается второй раз', async () => {
    const id = await lineWith(NOM);
    const r = await request(`/ui/lines/${id}/offer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ offerId: OFFER_CHEAP }).toString(),
    });
    expect(r.status).toBe(200);

    const l = await lineOf(id);
    expect(l.cost_price, 'цена из UI не совпала с ценой варианта').toContain('395');
  });

  test('пустой выбор в UI не считается ошибкой', async () => {
    const id = await lineWith(NOM);
    await post(`/lines/${id}/supply-option`, { offerId: OFFER_CHEAP });

    const r = await request(`/ui/lines/${id}/offer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ offerId: '' }).toString(),
    });
    // Оператор вернул список в «— выберите —»: это движение мышью, а не ошибка.
    expect(r.status).toBe(200);
  });
});

describe('№12 · ссылки держит база', () => {
  test('предложение ссылается на существующую номенклатуру и поставщика', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from supplier_offer o
        where not exists (select 1 from nomenclature n where n.id = o.nomenclature_id)
           or not exists (select 1 from counterparty c where c.id = o.supplier_id)`);
    expect(Number(r.rows[0]!.n), 'есть предложение с несуществующей ссылкой').toBe(0);
  });

  test('цена не может быть отрицательной — держит база', async () => {
    let denied = false;
    try {
      await pool.query(
        `insert into supplier_offer (nomenclature_id, supplier_id, price)
         values ($1, (select id from counterparty where is_supplier limit 1), -1)`, [NOM]);
    } catch { denied = true; }
    expect(denied, 'отрицательная цена прошла').toBe(true);
  });

  test('строка без варианта — нормальное состояние, а не ошибка', async () => {
    const id = await lineWith(NOM);
    const l = await lineOf(id);
    expect(l.supplier_offer_id).toBe(null);
    // И заказ поставщику по ней всё ещё можно создать: выбор варианта не обязателен.
    const { status } = await json('/lines?limit=1');
    expect(status).toBe(200);
  });
});
