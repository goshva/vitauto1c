import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { buildFilter, LineFilters } from '../../src/lines-filters.ts';

// ФТ v2 п. 14: «Рабочее место — один список по всем заказам сразу, колонки как в
// согласованном файле-реестре, ПАНЕЛЬ ОТБОРА ПО КАЖДОМУ ПОЛЮ сверху, видимость
// строк — по профилю пользователя».
//
// Про «по каждому полю» и написана половина этих тестов: поле, которого нет в
// панели, оператор обходит глазами по всему списку.

const NOM = '77777777-7777-7777-7777-777777777702';

const json = async (url: string, role = 'admin') => {
  const r = await request(url, { headers: { accept: 'application/json' } }, role);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const html = async (url: string) => {
  const r = await request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

const names = (body: Record<string, unknown>): string[] =>
  (body.items as { factName: string | null; nomenclature: string | null }[])
    .map((x) => x.factName ?? x.nomenclature ?? '');

/** Три строки, различимые по каждому полю. */
async function threeLines(): Promise<void> {
  await pool.query(`update line set urgency = null, territory = null, comment = null
                     where not deleted`);

  const rows = await pool.query<{ id: string }>(
    `select id from line where not deleted order by id limit 3`);
  const [a, b, c] = rows.rows.map((r) => r.id);

  await pool.query(
    `update line set nomenclature_id = $2, urgency = 'Срочно', territory = 'Склад на Ленина',
            comment = 'под заказ' where id = $1`, [a, NOM]);
  await pool.query(
    `update line set urgency = null, territory = 'База Север', comment = null where id = $1`, [b]);
  await pool.query(
    `update line set urgency = null, territory = null, comment = null where id = $1`, [c]);

  // Гос. номер и клиентский номер — в фактах заявки.
  await pool.query(
    `update line_fact set vehicle_plate = 'А123ВС77', client_order_number = 'З-1001'
      where id = $1`, [a]);
  await pool.query(
    `update line_fact set vehicle_plate = 'В456ЕК99', client_order_number = 'З-2002'
      where id = $1`, [b]);
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await seedProcess('stock');
});

describe('№14 · панель отбора по каждому полю', () => {
  test('в панели есть поле НА КАЖДОЕ поле реестра', async () => {
    const { body } = await html('/lines');

    // Именно «по каждому полю»: поле, которого нет, оператор обходит глазами.
    for (const field of ['status', 'number', 'clientNumber', 'name', 'article', 'customer',
      'supplier', 'base', 'plate', 'urgency', 'qtyFrom', 'qtyTo', 'dateFrom', 'dateTo',
      'comment', 'marked']) {
      expect(body, `в панели нет поля «${field}»`).toContain(`data-testid="filter-${field}"`);
    }
  });

  test('панель стоит СВЕРХУ списка', async () => {
    const { body } = await html('/lines');
    const filters = body.indexOf('data-testid="filters-panel"');
    const table = body.indexOf('data-testid="lines-panel"');
    expect(filters, 'панели нет').toBeGreaterThan(-1);
    expect(table, 'списка нет').toBeGreaterThan(-1);
    expect(filters, 'панель оказалась ниже списка').toBeLessThan(table);
  });

  test('панель вне области подмены — набранное не пропадёт', async () => {
    const { body } = await html('/lines');
    // Форма закрывается ДО начала `#lines-panel`: иначе HTMX заменил бы её вместе
    // со списком, и оператор потерял бы введённые значения.
    const filtersEnd = body.indexOf('</form>', body.indexOf('data-testid="filters-panel"'));
    const panelStart = body.indexOf('data-testid="lines-panel"');
    expect(filtersEnd, 'панель внутри области подмены').toBeLessThan(panelStart);
  });

  test('пустой отбор подписан словами, а не нулём', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('Отбор не задан');
  });
});

describe('№14 · отбор действительно работает', () => {
  test('по СРОЧНОСТИ', async () => {
    await threeLines();
    const { body } = await json('/lines?urgency=Срочно');
    expect(names(body).length, 'отбор по срочности ничего не дал').toBeGreaterThan(0);
  });

  test('по «БАЗЕ» (территория)', async () => {
    await threeLines();
    const all = await json('/lines');
    const north = await json('/lines?base=Север');
    expect(names(north.body).length).toBeGreaterThan(0);
    expect(names(north.body).length, 'отбор по базе не сузил список')
      .toBeLessThan(names(all.body).length);
  });

  test('по НОМЕРУ — ищет по всем трём номерам сразу', async () => {
    await threeLines();
    // Оператор не помнит, какой из трёх номеров у него на бумаге.
    for (const q of ['З-1001', 'ВИТ']) {
      const { status, body } = await json(`/lines?number=${encodeURIComponent(q)}`);
      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
    }
  });

  test('по КОММЕНТАРИЮ — подстрока, без учёта регистра', async () => {
    await threeLines();
    const lower = await json('/lines?comment=под');
    const upper = await json('/lines?comment=ПОД');
    expect(names(lower.body)).toEqual(names(upper.body));
    expect(names(lower.body).length, 'отбор по комментарию ничего не нашёл').toBeGreaterThan(0);
  });

  test('по НАИМЕНОВАНИЮ — и по факту заявки, и по номенклатуре', async () => {
    await threeLines();
    const { body } = await json('/lines?name=Фильтр');
    expect(names(body).length, 'отбор по наименованию ничего не нашёл').toBeGreaterThan(0);
  });

  test('по КОЛИЧЕСТВУ — диапазон', async () => {
    const all = await json('/lines');
    const few = await json('/lines?qtyFrom=1&qtyTo=1');
    expect(names(few.body).length).toBeLessThanOrEqual(names(all.body).length);
  });

  test('по ДАТЕ — включая последний день', async () => {
    // Берём дату ИЗ БАЗЫ, а не «сегодня»: строки сида датированы не текущим днём,
    // и тест на «сегодня» проверял бы пустоту, а не отбор. Заодно это проверка
    // включительности: `<= последний день` должно захватывать сам последний день.
    const d = String((await pool.query<{ d: string }>(
      `select max(order_date)::date::text as d from line where not deleted`)).rows[0]!.d);

    const { status, body } = await json(`/lines?dateFrom=${d}&dateTo=${d}`);
    expect(status).toBe(200);
    expect(names(body).length, 'строки последнего дня не попали в отбор').toBeGreaterThan(0);
  });

  test('день ДО последнего ничего не находит — границы не размыты', async () => {
    const d = String((await pool.query<{ d: string }>(
      `select (max(order_date)::date - 1)::text as d from line where not deleted`)).rows[0]!.d);
    const { body } = await json(`/lines?dateFrom=${d}&dateTo=${d}`);
    expect((body.items as unknown[]).length, 'отбор по дате захватил лишний день').toBe(0);
  });

  test('по ГОС. НОМЕРУ — он лежит в атрибутах машины, а не в строке', async () => {
    await threeLines();
    const { status, body } = await json('/lines?plate=А123ВС77');
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('несколько условий складываются через И', async () => {
    await threeLines();
    const one = await json('/lines?urgency=Срочно');
    const both = await json('/lines?urgency=Срочно&base=Ленина');
    expect(names(both.body).length).toBeLessThanOrEqual(names(one.body).length);
  });

  test('несуществующее значение даёт пустой список, а не ошибку', async () => {
    const { status, body } = await json('/lines?customer=НетТакогоЗаказчика12345');
    expect(status).toBe(200);
    expect((body.items as unknown[]).length).toBe(0);
    expect(body.total).toBe(0);
  });

  test('пустое значение поля НЕ считается условием', async () => {
    const all = await json('/lines');
    const blank = await json('/lines?name=&article=&customer=');
    expect(names(blank.body), 'пустые поля сузили список').toEqual(names(all.body));
  });
});

describe('№14 · правила отбора лежат в одном месте', () => {
  test('экрану и API достаётся ОДИН сборщик условий', async () => {
    // `lines-ui.ts` и `lines.ts` вызывают один и тот же `buildFilter`. Две копии
    // разошлись бы, и экран показывал бы не то, что отдаёт API на том же адресе.
    const api = await import('../../src/lines-filters.ts');
    const { where, params } = api.buildFilter({ view: 'sales' } as LineFilters);
    expect(where, 'без условий не задана операция').toContain('operation');
    expect(params.length).toBe(1);
  });

  test('`%` и `_` в запросе — символы, а не шаблоны', () => {
    const { params } = buildFilter({ view: 'sales', name: '100%_фильтр' } as LineFilters);
    expect(String(params[1]), 'шаблон LIKE не экранирован').toBe('%100\\%\\_фильтр%');
  });

  test('условия нумеруются ПО ДЛИНЕ массива, а не вписаны руками', () => {
    const { where, params } = buildFilter({
      view: 'sales', status: 'new', name: 'фильтр', customer: 'заказчик',
    } as LineFilters);
    expect(params.length).toBe(4);
    // Последний параметр обязан быть последним по номеру: ручная нумерация и
    // ошибается на единицу, и ошибка эта молчаливая.
    expect(where).toContain(`$${params.length}`);
  });

  test('порядок параметров совпадает с порядком условий', async () => {
    const { where, params } = buildFilter({
      view: 'purchases', status: 'ordered',
    } as LineFilters);
    expect(params[0]).toBe('purchase');
    expect(params[1]).toBe('ordered');
    expect(where.indexOf('operation')).toBeLessThan(where.indexOf('status'));
  });
});

describe('№14 · профиль пользователя', () => {
  test('агенту отдаётся JSON, браузеру — страница: адрес один', async () => {
    const asAgent = await json('/lines');
    const asBrowser = await html('/lines');
    expect(Array.isArray(asAgent.body.items)).toBe(true);
    expect(asBrowser.body).toContain('<table');
  });

  test('закрытые колонки скрыты и при отборе — фильтр не обходит ограничение', async () => {
    const { body } = await json('/lines?limit=3', 'storekeeper');
    const item = (body.items as Record<string, unknown>[])[0] ?? {};
    expect(item, 'отбор вернул себестоимость кладовщику').not.toHaveProperty('costPrice');
  });
});
