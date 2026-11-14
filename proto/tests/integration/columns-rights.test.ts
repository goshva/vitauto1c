import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// ФТ v2 п. 5: «Кладовщик — складские документы и колонки движения,
// БЕЗ ЦЕН ЗАКУПКИ И СЕБЕСТОИМОСТИ».
//
// Дыра была настоящая: экран себестоимость не показывал, а API её ВОЗВРАЩАЛ —
// и получить её можно было одной строкой в консоли браузера. Права по действию
// этого не закрывают: кладовщик законно открывает список строк, это его работа.
//
// Здесь проверяется ГРАНИЦА, а не «работает ли экран»: что закрыто, что открыто
// и что отказ объясняет причину.

type Role = 'admin' | 'manager' | 'mechanic' | 'storekeeper';
const as = (role: Role) => ({ accept: 'application/json', 'x-role': role });

const get = async (url: string, role: Role) => {
  const r = await app.request(url, { headers: as(role) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const patch = async (url: string, body: unknown, role: Role) => {
  const r = await app.request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...as(role) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const csv = async (url: string, role: Role) => {
  const r = await app.request(url, { headers: { 'x-role': role } });
  return { status: r.status, text: await r.text() };
};

const firstLine = async (): Promise<string> =>
  String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);

/** Кладём себестоимость: без неё «скрыто» и «пусто» не различить. */
async function withCost(): Promise<string> {
  const id = await firstLine();
  await pool.query(`update line set cost_price = 1234.56 where id = $1`, [id]);
  return id;
}

const first = (body: Record<string, unknown>): Record<string, unknown> =>
  (body.items as Record<string, unknown>[])[0]!;

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№5 · себестоимость закрыта кладовщику и механику', () => {
  test('в списке строк кладовщик себестоимости НЕ получает', async () => {
    await withCost();
    const { status, body } = await get('/lines?limit=5', 'storekeeper');
    expect(status).toBe(200);

    const row = first(body);
    expect(row, 'кладовщик получил себестоимость — утечка').not.toHaveProperty('costPrice');
    expect(row, 'кладовщик получил сумму себестоимости').not.toHaveProperty('costSum');
  });

  test('поле УДАЛЕНО, а не обнулено: пустота читалась бы как «не заполнено»', async () => {
    await withCost();
    const { body } = await get('/lines?limit=5', 'storekeeper');
    const row = first(body);

    expect('costPrice' in row, 'поле осталось со значением null').toBe(false);
  });

  test('механику себестоимость тоже закрыта', async () => {
    await withCost();
    const { body } = await get('/lines?limit=5', 'mechanic');
    expect(first(body)).not.toHaveProperty('costPrice');
  });

  test('менеджеру себестоимость видна — запрет не сломал работу', async () => {
    await withCost();
    const { body } = await get('/lines?limit=5', 'manager');
    expect(first(body), 'менеджер потерял себестоимость').toHaveProperty('costPrice');
    expect(String(first(body).costPrice)).toContain('1234.56');
  });

  test('администратору видно всё — условие заказчика «один админ за всех»', async () => {
    await withCost();
    const { body } = await get('/lines?limit=5', 'admin');
    expect(first(body)).toHaveProperty('costPrice');
  });

  test('на ОДИНОЧНОЙ строке тоже закрыто — иначе рядом открытая дверь', async () => {
    const id = await withCost();

    const keeper = await get(`/lines/${id}`, 'storekeeper');
    expect(keeper.body, 'утечка через /lines/{id}').not.toHaveProperty('costPrice');

    const manager = await get(`/lines/${id}`, 'manager');
    expect(manager.body).toHaveProperty('costPrice');
  });

  test('цена ПРОДАЖИ не закрыта: ФТ запрещает закупку и себестоимость, не любые цены', async () => {
    const { body } = await get('/lines?limit=5', 'storekeeper');
    // Кладовщик выписывает отгрузочные документы, и цена продажи в них есть.
    expect(first(body)).toHaveProperty('salePrice');
  });
});

describe('№5 · правка закрытого поля', () => {
  test('кладовщик не правит себестоимость', async () => {
    const id = await firstLine();
    const { status, body } = await patch(`/lines/${id}`, { field: 'cost_price', value: '999' }, 'storekeeper');

    expect(status).toBe(403);
    expect(body.code).toBe('forbidden');
    expect(String(body.message), 'отказ не называет поле').toContain('cost_price');
    expect(String(body.message), 'отказ не называет, кому можно').toContain('manager');
  });

  test('значение не изменилось — отказ не оставил следов', async () => {
    const id = await withCost();
    await patch(`/lines/${id}`, { field: 'cost_price', value: '999' }, 'storekeeper');

    const r = await pool.query<{ cost_price: string }>(
      `select cost_price from line where id = $1`, [id]);
    expect(String(r.rows[0]!.cost_price), 'себестоимость всё-таки изменилась').toContain('1234.56');
  });

  test('менеджер правит себестоимость', async () => {
    const id = await firstLine();
    const { status } = await patch(`/lines/${id}`, { field: 'cost_price', value: '777' }, 'manager');
    expect(status).toBe(200);

    const r = await pool.query<{ cost_price: string }>(
      `select cost_price from line where id = $1`, [id]);
    expect(String(r.rows[0]!.cost_price)).toContain('777');
  });

  test('открытые поля кладовщику по-прежнему доступны', async () => {
    const id = await firstLine();
    // Комментарий и зона — его работа, и запрет не должен её ломать.
    for (const field of ['comment', 'zone_id']) {
      const value = field === 'zone_id' ? '99999999-9999-9999-9999-999999999902' : 'принято';
      const { status } = await patch(`/lines/${id}`, { field, value }, 'storekeeper');
      expect(status, `кладовщик потерял право на «${field}»`).toBe(200);
    }
  });
});

describe('№5 · цены закупки закрыты', () => {
  test('кладовщик не видит сумму заказа поставщику', async () => {
    const { status, body } = await get('/supplier-orders', 'storekeeper');
    expect(status).toBe(200);

    const items = body.items as Record<string, unknown>[];
    if (items.length > 0) {
      expect(items[0], 'сумма закупки ушла кладовщику').not.toHaveProperty('total');
    }
  });

  test('сам заказ поставщику кладовщику виден — он по нему принимает товар', async () => {
    const { status } = await get('/supplier-orders', 'storekeeper');
    expect(status, 'кладовщику закрыли приёмку целиком').toBe(200);
  });

  test('выгрузка CSV не обходит закрытие', async () => {
    await withCost();
    const { status, text } = await csv('/lines/export', 'storekeeper');

    expect(status).toBe(200);
    expect(text, 'себестоимость уехала файлом').not.toContain('costPrice');
    expect(text.toLowerCase()).not.toContain('cost');
  });

  test('выгрузка менеджера не пострадала', async () => {
    const { status, text } = await csv('/lines/export', 'manager');
    expect(status).toBe(200);
    expect(text).toContain('salePrice');
  });
});

describe('№5 · правило лежит в одном месте', () => {
  test('закрытые поля перечислены явно, а не разбросаны по запросам', async () => {
    const { isHidden, deniedColumn } = await import('../../src/domain/columns.ts');

    expect(isHidden('storekeeper', 'cost_price')).toBe(true);
    // Оба написания: `camelCase` в ответе списка, `snake_case` в правке.
    expect(isHidden('storekeeper', 'costPrice')).toBe(true);
    expect(isHidden('manager', 'costPrice')).toBe(false);
    expect(deniedColumn('manager', 'cost_price')).toBeNull();
    expect(deniedColumn('storekeeper', 'cost_price')).toBeTruthy();
  });
});
