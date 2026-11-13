import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 4: зоны склада и перемещение строки между ними.
//
// Перемещение меняет МЕСТО, а не количество: движения склада не создаются, остаток
// не меняется. Это проверяется отдельно — иначе «перемещение» тихо превратилось бы
// в повторный приход.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';

const ZONE_SM = '99999999-9999-9999-9999-999999999902';   // малый склад
const ZONE_REP = '99999999-9999-9999-9999-999999999906';  // ремонтная зона
const ZONE_SUP = '99999999-9999-9999-9999-999999999911';  // возврат поставщику
const CELL_SM = '88888888-8888-8888-8888-888888888802';   // A-01, зона малого склада
const CELL_REP = '88888888-8888-8888-8888-888888888807';  // M-01, ремонтная зона
const CELL_BLOCKED = '88888888-8888-8888-8888-888888888804'; // B-01, неопознанные

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

const place = async (id: string) => {
  const r = await pool.query<{ z: string | null; c: string | null }>(
    `select zone_id::text z, cell_id::text c from line where id = $1`, [id],
  );
  return r.rows[0]!;
};
const moveCount = async (): Promise<number> =>
  Number((await pool.query<{ n: string }>(`select count(*)::text n from stock_move`)).rows[0]!.n);

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /zones — зоны склада', () => {
  test('отдаёт все зоны модели с ячейками', async () => {
    const { status, body } = await get('/zones');
    expect(status).toBe(200);

    const items = body.items as { code: string; cells: unknown[]; lines: number }[];
    expect(items.length, 'не все зоны попали в справочник').toBe(12);

    // Зоны, которых не хватало: они и были последним незакрытым пунктом.
    const codes = items.map((z) => z.code);
    for (const need of ['ASM', 'SHP', 'ADM', 'SUP', 'WO']) {
      expect(codes, `зона ${need} не заведена`).toContain(need);
    }
    expect(items.every((z) => Array.isArray(z.cells))).toBe(true);
    expect(items[0]!.cells.length).toBeGreaterThan(0);
  });

  test('фильтр по назначению зоны', async () => {
    const all = await get('/zones');
    const repair = await get('/zones?purpose=repair');
    expect((repair.body.items as unknown[]).length).toBe(1);
    expect((repair.body.items as { code: string }[])[0]!.code).toBe('REP');
    expect((repair.body.items as unknown[]).length).toBeLessThan((all.body.items as unknown[]).length);
  });

  test('зона сообщает, сколько строк в ней лежит', async () => {
    await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP });
    const { body } = await get('/zones?purpose=repair');
    expect((body.items as { lines: number }[])[0]!.lines).toBe(1);
  });
});

describe('POST /lines/{id}/zone — перемещение', () => {
  test('перемещает строку и подбирает свободную ячейку', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP });

    expect(status).toBe(200);
    expect(body.zone).toBe('REP');
    expect(body.cell, 'ячейка не подобрана').toBe('M-01');

    const at = await place(HAPPY);
    expect(at.z).toBe(ZONE_REP);
    expect(at.c).toBe(CELL_REP);
  });

  test('перемещение НЕ создаёт движение склада', async () => {
    const before = await moveCount();
    await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP });
    expect(await moveCount(), 'перемещение создало движение — остаток изменится').toBe(before);
  });

  test('явная ячейка принимается, если она из этой зоны', async () => {
    const { body } = await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_SM, cellId: CELL_SM });
    expect(body.cell).toBe('A-01');
  });

  test('ячейка из ДРУГОЙ зоны отвергается', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP, cellId: CELL_SM });
    expect(status).toBe(400);
    expect(body.field).toBe('cellId');
    expect(String(body.message)).toContain('не принадлежит зоне');
  });

  test('заблокированная ячейка отвергается', async () => {
    await pool.query(`update storage_cell set blocked = true where id = $1`, [CELL_BLOCKED]);
    const { status, body } = await post(`/lines/${HAPPY}/zone`, {
      zoneId: '99999999-9999-9999-9999-999999999904', cellId: CELL_BLOCKED,
    });
    expect(status).toBe(400);
    expect(String(body.message)).toContain('заблокирована');
  });

  test('неизвестная зона → 400 с именем поля', async () => {
    const { status, body } = await post(`/lines/${HAPPY}/zone`, {
      zoneId: '99999999-9999-9999-9999-9999999999ff',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('zoneId');
  });

  test('несуществующая строка → 404', async () => {
    const { status } = await post('/lines/00000000-0000-0000-0000-0000000000ff/zone', { zoneId: ZONE_REP });
    expect(status).toBe(404);
  });

  test('строка перемещается между зонами многократно', async () => {
    await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP });
    await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_SUP });
    const at = await place(HAPPY);

    expect(at.z, 'строка осталась в прежней зоне').toBe(ZONE_SUP);
    const sup = await pool.query<{ code: string }>(
      `select code from storage_cell where zone_id = $1 order by code limit 1`, [ZONE_SUP],
    );
    expect(at.c).toBeTruthy();
    expect(sup.rowCount).toBeGreaterThan(0);
  });

  test('версия строки растёт — If-Match продолжает работать', async () => {
    const before = Number((await pool.query<{ v: string }>(
      `select version::text v from line where id = $1`, [HAPPY],
    )).rows[0]!.v);

    const { body } = await post(`/lines/${HAPPY}/zone`, { zoneId: ZONE_REP });
    expect(Number(body.version)).toBe(before + 1);
  });
});
