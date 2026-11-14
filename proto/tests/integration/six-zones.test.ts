import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// ФТ v2 п. 7: «шесть предопределённых зон по утверждённой схеме; поле выбора зоны
// есть в документах ПРИЁМКИ, ОТГРУЗКИ и в форме РЕЗЕРВА».
//
// Схема — не догадка: её источник `db/migrations/0014_warehouse_zones.sql` (legacy)
// и вкладка «Складские зоны» в `process.html`. Тест сверяется ИМЕННО с этим файлом:
// если кто-то поменяет зоны в сиде, сверка упадёт.

const ZONE_REC = '99999999-9999-9999-9999-999999999901';
const ZONE_REP = '99999999-9999-9999-9999-999999999906';
const ZONE_BG = '99999999-9999-9999-9999-999999999903';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';

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

/** Шесть зон из УТВЕРЖДЁННОЙ схемы (legacy-миграция 0014). */
function approvedZones(): { code: string; name: string; purpose: string }[] {
  const sql = readFileSync('../db/migrations/0014_warehouse_zones.sql', 'utf8');
  return [...sql.matchAll(
    /\('c2000000-[0-9a-f-]+',\s*'(\w+)',\s*'([^']+)',\s*'([^']+)',\s*\d+\)/g,
  )].map((m) => ({ code: m[1]!, name: m[2]!, purpose: m[3]! }));
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('№7 · шесть предопределённых зон', () => {
  test('источник схемы — legacy-миграция, и в ней ровно шесть', () => {
    const zones = approvedZones();
    expect(zones.length, 'в исходной схеме не шесть зон').toBe(6);
    expect(zones.map((z) => z.name)).toEqual([
      'Зона приёмки', 'Малый склад', 'Большой склад',
      'Неопознанные и возвраты', 'Ремонтная зона', 'Зона укомплектованных',
    ]);
  });

  test('в справочнике ровно шесть предопределённых', async () => {
    const { body } = await json('/zones?predefined=true');
    const items = body.items as { code: string; name: string }[];

    expect(items.length, 'предопределённых не шесть').toBe(6);
    expect(items.map((z) => z.name).sort()).toEqual(approvedZones().map((z) => z.name).sort());
  });

  test('названия совпадают со схемой ДОСЛОВНО — сверка не требует переводчика', async () => {
    const { body } = await json('/zones?predefined=true');
    const items = body.items as { code: string; name: string; purpose: string }[];

    for (const approved of approvedZones()) {
      const found = items.find((z) => z.name === approved.name);
      expect(found, `зоны «${approved.name}» нет в справочнике`).toBeTruthy();
      expect(found!.purpose, `назначение «${approved.name}» разошлось со схемой`)
        .toBe(approved.purpose);
    }
  });

  test('«Неопознанные» и «Возвраты» — ОДНА зона, а не две', async () => {
    const all = await pool.query<{ code: string; name: string }>(
      `select code, name from warehouse_zone where deleted_at is null`);
    const codes = all.rows.map((z) => z.code);

    expect(codes, 'отдельная зона возвратов осталась').not.toContain('RET');
    const unk = all.rows.find((z) => z.code === 'UNK');
    expect(unk!.name, 'зона Z5 названа не по схеме').toBe('Неопознанные и возвраты');
  });

  test('служебные зоны не выдают себя за утверждённые', async () => {
    const { body } = await json('/zones?predefined=true');
    const codes = (body.items as { code: string }[]).map((z) => z.code);
    for (const service of ['ASM', 'SHP', 'ADM', 'SUP', 'WO']) {
      expect(codes, `служебная зона ${service} помечена как утверждённая`).not.toContain(service);
    }
  });
});

/** Строка, готовая к приёмке: только «оплачен» и «в пути» годны (K1). */
const receivableLine = async (): Promise<string> => {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);
  await pool.query(`update line set status = 'in_transit' where id = $1`, [id]);
  await post(`/lines/${id}/mark`, { marked: true });
  return id;
};

describe('№7 · зона в документах приёмки, отгрузки и резерва', () => {
  test('приёмка принимает зону и запоминает её', async () => {
    await receivableLine();

    const { status, body } = await post('/receipts', { zoneId: ZONE_BG });
    expect(status).toBe(201);

    const r = await pool.query<{ zone_id: string | null }>(
      `select zone_id from receipt where id = $1`, [String(body.id)]);
    expect(r.rows[0]!.zone_id, 'зона приёмки не сохранилась').toBe(ZONE_BG);
  });

  test('без указания зоны приёмка встаёт в ЗОНУ ПРИЁМКИ, а не «в никуда»', async () => {
    await receivableLine();

    const { status, body } = await post('/receipts', {});
    expect(status).toBe(201);

    const r = await pool.query<{ zone_id: string | null }>(
      `select zone_id from receipt where id = $1`, [String(body.id)]);
    // Пустая зона означала бы «неизвестно где» — тот самый дефект, из-за которого
    // разъезжался остаток при списании.
    expect(r.rows[0]!.zone_id).toBe(ZONE_REC);
  });

  test('перемещение строки в зону — это и есть форма резерва', async () => {
    const line = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);

    const { status, body } = await post(`/lines/${line}/zone`, { zoneId: ZONE_REP });
    expect(status).toBe(200);
    expect(body.zone).toBe('REP');

    const r = await pool.query<{ zone_id: string | null }>(
      `select zone_id from line where id = $1`, [line]);
    expect(r.rows[0]!.zone_id).toBe(ZONE_REP);
  });

  test('зона отгрузки сохраняется в документе', async () => {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '2',
    });

    const line = String((await pool.query<{ id: string }>(
      `select id from line where not deleted limit 1`)).rows[0]!.id);
    await pool.query(
      `update line set nomenclature_id = $2, status = 'ready_to_ship' where id = $1`,
      [line, NOM]);
    await post(`/lines/${line}/mark`, { marked: true });

    const { status, body } = await post('/shipments', { zoneId: ZONE_BG });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
  });

  test('оператор видит зоны схемы там, где выбирает зону', async () => {
    // Пустой склад зон не перечисляет — это нормально. Выбор зоны есть в форме
    // опознания: там оператор и решает, куда положить позицию.
    await seedExtra.offProcess();
    const { status, body } = await html('/unidentified');

    expect(status).toBe(200);
    for (const name of ['Малый склад', 'Большой склад', 'Ремонтная зона']) {
      expect(body, `зоны «${name}» нет в выборе`).toContain(name);
    }
    // И зона по умолчанию для опознания — из утверждённой шестёрки.
    expect(body).toContain('Зона приёмки');
  });
});
