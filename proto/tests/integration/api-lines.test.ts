import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: контракт API исполняется, а не описан.
//
// Проверяются три вещи, которые в legacy НЕ исполнялись:
//   1. `?status=` с неизвестным кодом → 400, а не «весь список» (C18);
//   2. `If-Match` устаревшей версии → 409 с конкретным текстом;
//   3. переход из недопустимого статуса → конкретная причина, а не «Обработано 0 из 1» (C21).

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const STOCK = 'b0000000-0000-0000-0000-000000000002';

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /lines', () => {
  test('возвращает строки и общее число', async () => {
    const r = await app.request('/lines?view=sales');
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(Array.isArray(b.items)).toBe(true);
    expect((b.items as unknown[]).length).toBeGreaterThan(0);
    expect(typeof b.total).toBe('number');
  });

  test('фильтр по известному статусу сужает выборку', async () => {
    const all = await json(await app.request('/lines?view=sales'));
    const only = await json(await app.request('/lines?view=sales&status=new'));
    expect((only.items as unknown[]).length).toBeLessThanOrEqual((all.items as unknown[]).length);
    for (const it of only.items as { status: string }[]) expect(it.status).toBe('new');
  });

  test('НЕИЗВЕСТНЫЙ статус → 400, а не весь список (C18)', async () => {
    const r = await app.request('/lines?view=sales&status=нетакого');
    expect(r.status, 'молчаливый игнор фильтра — это C18').toBe(400);
    const b = await json(r);
    expect(String(b.code)).toBe('bad_request');
    expect(String(b.message)).toContain('Неизвестный статус');
  });

  test('у каждой строки есть id и статус', async () => {
    const b = await json(await app.request('/lines?view=sales'));
    for (const it of b.items as { id: string; status: string }[]) {
      expect(it.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof it.status).toBe('string');
    }
  });
});

describe('GET /lines/{id}', () => {
  test('находит засеянную строку', async () => {
    const r = await app.request(`/lines/${HAPPY}`);
    expect(r.status).toBe(200);
    expect((await json(r)).id).toBe(HAPPY);
  });

  test('несуществующая строка → 404 с problem+json', async () => {
    const r = await app.request('/lines/00000000-0000-0000-0000-0000000000ff');
    expect(r.status).toBe(404);
    const b = await json(r);
    expect(b.code).toBe('not_found');
    expect(b.traceId, 'в ошибке должен быть traceId').toBeTruthy();
  });
});

describe('PATCH /lines/{id}', () => {
  test('меняет поле и увеличивает версию', async () => {
    const before = await json(await app.request(`/lines/${HAPPY}`));
    const v0 = Number((await pool.query<{ v: string }>(`select version::text v from line where id=$1`, [HAPPY])).rows[0]!.v);

    const r = await app.request(`/lines/${HAPPY}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': String(v0) },
      body: JSON.stringify({ field: 'quantity', value: 5 }),
    });
    expect(r.status).toBe(200);
    expect(Number((await json(r)).version)).toBe(v0 + 1);
    expect(before.id).toBe(HAPPY);
  });

  test('устаревший If-Match → 409 с указанием версий', async () => {
    const v = Number((await pool.query<{ v: string }>(`select version::text v from line where id=$1`, [HAPPY])).rows[0]!.v);
    const r = await app.request(`/lines/${HAPPY}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': String(v - 1) },
      body: JSON.stringify({ field: 'quantity', value: 7 }),
    });
    expect(r.status).toBe(409);
    const b = await json(r);
    expect(b.code).toBe('version_conflict');
    expect(String(b.message)).toContain(`ожидалась версия ${v - 1}`);
  });

  test('нередактируемое поле → 400 field_readonly', async () => {
    const r = await app.request(`/lines/${HAPPY}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'status', value: 'closed' }),
    });
    expect(r.status).toBe(400);
    expect((await json(r)).code).toBe('field_readonly');
  });
});

describe('POST /lines/{id}/mark', () => {
  test('ставит и снимает отметку', async () => {
    const on = await app.request(`/lines/${HAPPY}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    expect(on.status).toBe(200);
    expect((await json(on)).marked).toBe(true);

    const off = await app.request(`/lines/${HAPPY}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: false }),
    });
    expect((await json(off)).marked).toBe(false);
  });
});

describe('POST /lines/transition', () => {
  test('без отметок → 409 nothing_marked', async () => {
    const r = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'reserve' }),
    });
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe('nothing_marked');
  });

  test('переход reserve из new выполняется: статус меняется, отметка снимается', async () => {
    await app.request(`/lines/${HAPPY}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });

    const r = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'reserve' }),
    });
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.processed).toBe(1);
    expect(b.skipped).toEqual([]);

    const after = await json(await app.request(`/lines/${HAPPY}`));
    expect(after.status).toBe('reserve');
    expect(after.marked, 'после перехода отметка снимается').toBe(false);
  });

  test('переход из недопустимого статуса даёт КОНКРЕТНУЮ причину (C21)', async () => {
    // Строка stock в new; переводим в reserve, затем пробуем ready_to_ship (нужен assembly).
    await app.request(`/lines/${STOCK}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'reserve' }),
    });

    await app.request(`/lines/${STOCK}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    const r = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'ready_to_ship' }),
    });
    const b = await json(r);
    expect(b.processed).toBe(0);
    const skipped = b.skipped as string[];
    expect(skipped.length).toBe(1);
    expect(skipped[0], 'причина должна называть статус и доступные переходы')
      .toContain('Из статуса «reserve»');
  });

  test('неизвестный переход → 400 со списком допустимых', async () => {
    const r = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'нетакого' }),
    });
    expect(r.status).toBe(400);
    expect(String((await json(r)).message)).toContain('Допустимые');
  });

  test('закрытие отгруженной строки требует «Документ подписан оригинал» (C22)', async () => {
    // Готовим строку в shipped: reserve → assembly → ready_to_ship → shipped недоступен
    // из ready_to_ship, поэтому идём reserve → assembly → ready_to_ship, затем
    // ставим статус shipped напрямую (сид-подобно) и проверяем условие закрытия.
    await pool.query(`update line set status = 'shipped', signed_original = false where id = $1`, [HAPPY]);
    await app.request(`/lines/${HAPPY}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });

    const r = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'closed' }),
    });
    const b = await json(r);
    expect(b.processed, 'без галки закрывать нельзя').toBe(0);
    expect((b.skipped as string[])[0]).toContain('Документ подписан оригинал');

    // С галкой — закрывается.
    await pool.query(`update line set signed_original = true where id = $1`, [HAPPY]);
    await app.request(`/lines/${HAPPY}/mark`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marked: true }),
    });
    const r2 = await app.request('/lines/transition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'closed' }),
    });
    expect((await json(r2)).processed).toBe(1);
  });
});
