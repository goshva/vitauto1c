import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// ФТ v2 п. 19: «В справочник „Номенклатура“ добавлены нужные поля (бренд, код
// поставщика, наименование для печати); единица хранения на складе по умолчанию —
// штуки, без жёсткого запрета смены».
//
// ЧТО БЫЛО НЕ ТАК. `brand_id` в схеме БЫЛ, а таблицы `brand` не было — висячий UUID
// без связи: выбрать бренд негде, проверить нечем. `full_name` тоже был, но печатные
// формы его не использовали: в бланк шло короткое имя. Кода поставщика не было вовсе.

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777702';
const PIECE_UNIT = '77777777-7777-7777-7777-7777777777a1';
const LITER_UNIT = '77777777-7777-7777-7777-7777777777a2';

const json = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'application/json' } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = async (url: string, body?: unknown) => {
  const r = await app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

const nom = async (id = NOM): Promise<Record<string, unknown>> => {
  const { body } = await json(`/refs/nomenclature?q=${id === NOM ? 'Фильтр масляный' : ''}`);
  const items = body.items as Record<string, unknown>[];
  return items.find((x) => x.id === id) ?? items[0]!;
};

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№19 · бренд', () => {
  test('справочник брендов существует и отдаётся', async () => {
    const { status, body } = await json('/refs/brands');
    expect(status).toBe(200);

    const items = body.items as { name: string }[];
    expect(items.length, 'брендов нет').toBeGreaterThan(0);
    expect(items.map((b) => b.name)).toContain('Mann-Filter');
  });

  test('номенклатура отдаёт бренд И его название, а не только идентификатор', async () => {
    const item = await nom();
    expect(item, 'brand_id пропал из карточки').toHaveProperty('brand_id');
    // Идентификатор без названия бесполезен: оператор не должен ходить в другой
    // запрос, чтобы узнать, что это за бренд.
    expect(item, 'название бренда не присоединено').toHaveProperty('brand');
    expect(item.brand).toBe('Mann-Filter');
  });

  test('brand_id связан со справочником, а не висит в воздухе', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from nomenclature n
        where n.brand_id is not null
          and not exists (select 1 from brand b where b.id = n.brand_id)`);
    expect(Number(r.rows[0]!.n), 'есть brand_id без бренда в справочнике').toBe(0);
  });

  test('связь держит база, а не договорённость', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
       where tc.table_name = 'nomenclature' and tc.constraint_type = 'FOREIGN KEY'
         and ccu.table_name = 'brand'`);
    expect(Number(rows[0]!.n), 'внешнего ключа на brand нет').toBe(1);
  });
});

describe('№19 · код поставщика', () => {
  test('номенклатура отдаёт код поставщика', async () => {
    const item = await nom();
    expect(item, 'кода поставщика нет в карточке').toHaveProperty('ext_code');
    expect(item.ext_code).toBe('W914-2');
  });

  test('код поставщика НЕ подменяет наш артикул — это разные коды', async () => {
    const item = await nom();
    expect(item.article).toBe('FLT-OIL-001');
    expect(item.ext_code).toBe('W914-2');
    expect(item.article, 'коды совпали — значит один затёр другой').not.toBe(item.ext_code);
  });

  test('по коду поставщика можно ИСКАТЬ — иначе он бесполезен', async () => {
    // Оператор держит накладную поставщика, где стоит ЕГО код, а не наш артикул.
    const { status, body } = await json('/refs/nomenclature?q=W914-2');
    expect(status).toBe(200);

    const items = body.items as { name: string; ext_code: string | null }[];
    expect(items.length, 'поиск по коду поставщика ничего не нашёл').toBeGreaterThan(0);
    expect(items[0]!.ext_code).toBe('W914-2');
  });

  test('по коду поставщика есть индекс — иначе поиск идёт перебором', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from pg_indexes
        where tablename = 'nomenclature' and indexdef ilike '%ext_code%'`);
    expect(Number(r.rows[0]!.n), 'нет индекса по коду поставщика').toBeGreaterThan(0);
  });
});

describe('№19 · наименование для печати', () => {
  test('в бланк идёт ПОЛНОЕ имя, а не короткое', async () => {
    // Наряд с запчастью, у которой печатное имя отличается от короткого.
    const { body: order } = await post('/work-orders', {
      carId: CAR, serviceTypeId: SERVICE, comment: 'Печать наименования',
    });
    await post(`/work-orders/${String(order.id)}/part`, {
      nomenclatureId: NOM, quantity: '1', salePrice: '500',
    });

    const { body } = await html(`/print/work_order?workOrderId=${String(order.id)}`);
    expect(body, 'в бланке короткое имя вместо печатного').toContain('Фильтр масляный, шт');
  });

  test('пустое печатное имя не оставляет пустую ячейку', async () => {
    // У позиции без печатного имени в бланк должно идти короткое.
    await pool.query(`update nomenclature set full_name = null where id = $1`, [NOM]);
    const { body: order } = await post('/work-orders', {
      carId: CAR, serviceTypeId: SERVICE,
    });
    await post(`/work-orders/${String(order.id)}/part`, {
      nomenclatureId: NOM, quantity: '1', salePrice: '500',
    });

    const { body } = await html(`/print/work_order?workOrderId=${String(order.id)}`);
    expect(body, 'пустое печатное имя оставило пустоту').toContain('Фильтр масляный');
  });
});

describe('№19 · единица измерения', () => {
  test('по умолчанию у товаров — штуки', async () => {
    const { body } = await json('/refs/nomenclature');
    const goods = (body.items as { kind: string; unit_id: string }[])
      .filter((n) => n.kind === 'good' && n.unit_id === PIECE_UNIT);
    expect(goods.length, 'ни один товар не в штуках').toBeGreaterThan(0);
  });

  test('единица НЕ жёстко штуки: литры допустимы и заведены', async () => {
    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from nomenclature where unit_id = $1`, [LITER_UNIT]);
    expect(Number(r.rows[0]!.n), 'единицу нельзя сменить — литров нет').toBeGreaterThan(0);
  });

  test('единицу можно сменить у конкретной позиции', async () => {
    const before = await nom();
    expect(before.unit_id).toBe(PIECE_UNIT);

    // «Без жёсткого запрета смены» — значит смена проходит.
    await pool.query(`update nomenclature set unit_id = $2 where id = $1`, [NOM, LITER_UNIT]);
    const after = await nom();
    expect(after.unit_id, 'единица не сменилась').toBe(LITER_UNIT);
  });

  test('единица ссылается на справочник единиц', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text n from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
       where tc.table_name = 'nomenclature' and tc.constraint_type = 'FOREIGN KEY'
         and ccu.table_name = 'unit'`);
    expect(Number(rows[0]!.n), 'внешнего ключа на unit нет').toBe(1);
  });
});

describe('№19 · прочие справочники не задеты', () => {
  test('все шесть справочников отвечают', async () => {
    for (const path of ['nomenclature', 'counterparties', 'units', 'warehouses',
      'payment-forms', 'service-kinds', 'brands']) {
      const { status } = await json(`/refs/${path}`);
      expect(status, `справочник ${path} сломан`).toBe(200);
    }
  });

  test('поиск работает и после присоединения бренда', async () => {
    const { status, body } = await json('/refs/nomenclature?q=Фильтр');
    expect(status).toBe(200);
    expect((body.items as unknown[]).length, 'поиск перестал находить').toBeGreaterThan(0);
  });
});
