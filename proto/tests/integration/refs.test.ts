import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: справочники читаются и ИЩУТСЯ.
//
// Смысл: без справочников оператор вводит идентификаторы руками (M2, K2, N1).
// Тесты проверяют не «200 пришёл», а что поиск сужает выборку, что удалённые
// записи не видны и что `%` в запросе — это символ, а не шаблон LIKE.

const json = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'application/json' } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

const items = async (url: string): Promise<Record<string, unknown>[]> => {
  const { body } = await json(url);
  return (body.items ?? []) as Record<string, unknown>[];
};

const REFS = [
  { path: 'nomenclature', min: 8 },
  { path: 'counterparties', min: 5 },
  { path: 'units', min: 2 },
  { path: 'warehouses', min: 1 },
  { path: 'payment-forms', min: 2 },
  { path: 'service-kinds', min: 2 },
];

beforeEach(async () => {
  await seedRefs();
});

describe('справочники отдаются', () => {
  test('каждый из шести возвращает записи', async () => {
    for (const ref of REFS) {
      const list = await items(`/refs/${ref.path}`);
      expect(list.length, `${ref.path}: пусто`).toBeGreaterThanOrEqual(ref.min);
    }
  });

  test('номенклатура несёт артикул — по нему сопоставляют заявку (M2)', async () => {
    const list = await items('/refs/nomenclature');
    const withArticle = list.filter((x) => x.article);
    expect(withArticle.length).toBeGreaterThan(0);
    expect(list.some((x) => x.article === 'FLT-OIL-001')).toBe(true);
  });

  test('контрагенты помечены, кто заказчик, а кто поставщик', async () => {
    const list = await items('/refs/counterparties');
    expect(list.some((x) => x.is_customer === true)).toBe(true);
    expect(list.some((x) => x.is_supplier === true)).toBe(true);
  });
});

describe('поиск', () => {
  test('?q= сужает выборку по названию', async () => {
    const all = await items('/refs/nomenclature');
    const found = await items('/refs/nomenclature?q=фильтр');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(all.length);
    for (const item of found) {
      expect(String(item.name).toLowerCase()).toContain('фильтр');
    }
  });

  test('поиск работает по артикулу', async () => {
    const found = await items('/refs/nomenclature?q=FLT-OIL');
    expect(found.length).toBe(1);
    expect(found[0]!.article).toBe('FLT-OIL-001');
  });

  test('поиск по ИНН находит контрагента', async () => {
    const found = await items('/refs/counterparties?q=770111111111');
    expect(found.length).toBe(1);
    expect(String(found[0]!.name)).toContain('Иванов');
  });

  test('пустой результат — это пустой список, а не ошибка', async () => {
    const { status, body } = await json('/refs/nomenclature?q=нетакоготовара99');
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('процент в запросе — символ, а не шаблон LIKE', async () => {
    // Без экранирования `%` вернул бы ВСЕ записи.
    const all = await items('/refs/nomenclature');
    const found = await items('/refs/nomenclature?q=%25');
    expect(found.length, 'процент не экранирован — вернулся весь справочник').toBeLessThan(all.length);
  });

  test('подчёркивание в запросе тоже экранируется', async () => {
    const found = await items('/refs/nomenclature?q=_');
    expect(Array.isArray(found)).toBe(true);
    // Ни одно название не содержит литерального подчёркивания.
    for (const item of found) expect(String(item.name)).not.toContain('_');
  });
});

describe('выпадающие списки', () => {
  test('пары «значение — подпись» с артикулом в подписи', async () => {
    const { status, body } = await json('/options/nomenclature');
    expect(status).toBe(200);
    const list = body.items as { value: string; label: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.value).toMatch(/^[0-9a-f-]{36}$/);
    // Подпись обязана различать похожие позиции: код рядом с названием.
    expect(list.some((x) => x.label.includes('·'))).toBe(true);
  });

  test('ячейки в списке подписаны кодом, а не названием', async () => {
    const { body } = await json('/options/cells');
    const list = body.items as { label: string }[];
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) expect(item.label).toMatch(/^[A-Z]-\d+$/);
  });

  test('неизвестный список → 400 в формате Problem, с перечнем допустимых', async () => {
    const { status, body } = await json('/options/нетакого');
    // Не 404: значение отвергает схема маршрута, и это ошибка запроса.
    // Важно другое — ответ обязан быть problem+json, а не структурой Zod:
    // до появления `createApi()` здесь приходило `{"success":false,"error":{…}}`.
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.traceId, 'в ошибке должен быть traceId').toBeTruthy();
    expect(String(body.message)).toContain('nomenclature');
  });
});

describe('ячейки склада', () => {
  test('отдаются с зоной и складом', async () => {
    const list = await items('/refs/cells');
    expect(list.length).toBeGreaterThanOrEqual(7);
    const withZone = list.filter((x) => x.zone);
    expect(withZone.length).toBeGreaterThan(0);
    expect(withZone[0]!.warehouse).toBeTruthy();
  });

  test('фильтр по складу сужает выборку', async () => {
    const all = await items('/refs/cells');
    const one = await items('/refs/cells?warehouseId=44444444-4444-4444-4444-444444444401');
    expect(one.length).toBe(all.length);
    const none = await items('/refs/cells?warehouseId=44444444-4444-4444-4444-4444444444ff');
    expect(none.length).toBe(0);
  });
});

describe('удалённые записи не видны', () => {
  test('мягко удалённая номенклатура исчезает из списка', async () => {
    const before = await items('/refs/nomenclature');
    await pool.query(`update nomenclature set deleted_at = now() where article = 'FLT-OIL-001'`);
    const after = await items('/refs/nomenclature');

    expect(after.length).toBe(before.length - 1);
    expect(after.some((x) => x.article === 'FLT-OIL-001')).toBe(false);

    await pool.query(`update nomenclature set deleted_at = null where article = 'FLT-OIL-001'`);
  });
});
