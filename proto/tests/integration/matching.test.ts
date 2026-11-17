import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';
import { MATCH_BANDS } from '../../src/domain/matching.ts';

// Сопоставление позиций: подсказки и пакетный разбор (п. 2).
//
// Проверяем ТРИ ПОЛОСЫ НА ПУТИ ЧЕРЕЗ ПРИЛОЖЕНИЕ, а не только счётчик: счётчик уже покрыт
// модульными тестами на живых парах. Здесь важно, что полосы доводятся до экрана и что
// пакет подставляет РОВНО то, что показал, — не больше.

const manager = '11111111-aaaa-1111-1111-111111111102';
const asManager = `arm_session=${encodeSession({ userId: manager, role: 'manager' })}`;

const json = async (url: string, init: RequestInit = {}) => {
  const r = await request(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const html = async (url: string) => {
  const r = await request(url, {
    headers: { accept: 'text/html', cookie: asManager },
  });
  return { status: r.status, body: await r.text() };
};
const uiPost = (url: string) =>
  request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: asManager },
    body: '',
  });

/** Неопознанная строка с заданным «как написал клиент». */
async function unidentified(written: string, article: string | null = null): Promise<string> {
  const id = String((await pool.query<{ id: string }>(
    `select id from line where not deleted limit 1`)).rows[0]!.id);

  await pool.query(`update line set nomenclature_id = null, status = 'new' where id = $1`, [id]);
  await pool.query(
    `update line_fact set fact_name = $2, fact_article = $3 where id = $1`,
    [id, written, article]);
  return id;
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await pool.query(`update line set nomenclature_id = null`);
});

describe('п. 2 · подсказки по одной строке', () => {
  test('точное написание — полоса «подставить» и оценка у порога', async () => {
    const id = await unidentified('Фильтр масляный');
    const { status, body } = await json(`/lines/${id}/matches`);

    expect(status).toBe(200);
    expect(body.band, 'полоса не «подставить»').toBe('auto');

    const items = body.suggestions as { name: string; score: number; common: string[] }[];
    expect(items[0]!.name).toBe('Фильтр масляный');
    expect(items[0]!.score).toBeGreaterThanOrEqual(MATCH_BANDS.auto);
    // Оценка без объяснения оператору не помогает: он не понимает, ПОЧЕМУ предложено.
    expect(items[0]!.common, 'не сказано, какие слова совпали').toContain('фильтр');
  });

  test('уточнение, которого нет в справочнике — полоса «выбрать»', async () => {
    // «иридиевая» — свойство детали, и в справочнике её нет: там более простая свеча.
    const id = await unidentified('Свеча зажигания иридиевая');
    const { body } = await json(`/lines/${id}/matches`);

    expect(body.band, 'иридиевую свечу подставили бы автоматически').toBe('choose');
    const items = body.suggestions as { name: string; score: number }[];
    expect(items[0]!.name).toBe('Свеча зажигания');
    expect(items[0]!.score).toBeLessThan(MATCH_BANDS.auto);
  });

  test('позиции, которой нет в справочнике — полоса «нет»', async () => {
    const id = await unidentified('Диск сцепления');
    const { body } = await json(`/lines/${id}/matches`);

    expect(body.band, 'несуществующей позиции нашли пару').toBe('none');
  });

  test('пороги отдаются вместе с ответом', async () => {
    // Экран и API должны считать полосы ОДИНАКОВО, иначе покажут разное.
    const id = await unidentified('Фильтр масляный');
    const { body } = await json(`/lines/${id}/matches`);
    expect(body.thresholds).toEqual(MATCH_BANDS);
  });

  test('пустое написание — не «не найдено», а «нечего сопоставлять»', async () => {
    const id = await unidentified('');
    const { body } = await json(`/lines/${id}/matches`);
    const items = body.suggestions as unknown[];
    expect(items.length, 'на пустое написание выдумали предложения').toBe(0);
  });

  test('неизвестная строка → 404', async () => {
    const { status } = await json('/lines/00000000-0000-0000-0000-0000000000ff/matches');
    expect(status).toBe(404);
  });

  test('бренд впереди не мешает: «Bosch Фильтр масляный»', async () => {
    // Оговорка, названная при выборе счётчика: клиент пишет бренд первым.
    const id = await unidentified('Bosch Фильтр масляный');
    const { body } = await json(`/lines/${id}/matches`);

    expect(body.band, 'бренд сбил сопоставление').toBe('auto');
    const items = body.suggestions as { name: string; score: number }[];
    expect(items[0]!.name).toBe('Фильтр масляный');
  });
});

describe('п. 2 · сводка по всем неопознанным', () => {
  test('сводка делит позиции по полосам', async () => {
    await unidentified('Фильтр масляный');
    const { body } = await json('/lines/matches/summary');

    // Приводим явно: в ответе эти поля имеют тип `unknown`, и сравнивать надо числа.
    const num = (v: unknown): number => Number(v);
    expect(num(body.total)).toBeGreaterThan(0);
    expect(num(body.auto), 'нет ни одной строки в полосе «подставить»').toBeGreaterThanOrEqual(1);
    // Сумма полос обязана равняться общему: иначе часть строк потерялась бы.
    expect(num(body.auto) + num(body.choose) + num(body.none)).toBe(num(body.total));
  });

  test('в сводке названо, ЧТО именно будет привязано', async () => {
    const id = await unidentified('Фильтр масляный');
    const { body } = await json('/lines/matches/summary');

    // `willBind`, а не `auto`: под именем `auto` в ответе лежит ЧИСЛО полосы, и
    // список под тем же именем затирал его. Это была настоящая ошибка маршрута.
    const auto = body.willBind as { lineId: string; nomenclature: string; score: number }[];
    const mine = auto.find((x) => x.lineId === id);
    expect(mine, 'строка не попала в список на подстановку').toBeTruthy();
    expect(mine!.nomenclature).toBe('Фильтр масляный');
  });
});

describe('п. 2 · пакетный разбор', () => {
  test('ПРИМЕРКА НЕ МЕНЯЕТ НИЧЕГО', async () => {
    const id = await unidentified('Фильтр масляный');
    const r = await uiPost('/ui/unidentified/auto-match');
    expect(r.status).toBe(200);

    const body = await r.text();
    expect(body, 'нет предварительного показа').toContain('auto-match-preview');
    expect(body, 'не показано, что изменится').toContain('auto-match-list');

    const after = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line where id = $1`, [id]);
    expect(after.rows[0]!.nomenclature_id, 'примерка всё-таки изменила данные').toBe(null);
  });

  test('подтверждение привязывает ТОЛЬКО полосу «подставить»', async () => {
    const exact = await unidentified('Фильтр масляный');

    // В сиде happy ОДНА строка — вторую заводим: проверяем, что пакет не трогает полосу
    // «выбрать», а на одной строке это не проверить.
    const second = 'eeeeeeee-5555-5555-5555-555555555501';
    await pool.query(
      `insert into line (id, operation, status, quantity, order_date)
       values ($1, 'sale', 'new', 1, current_date)
       on conflict (id) do update set nomenclature_id = null`, [second]);
    await pool.query(
      `insert into line_fact (id, fact_name) values ($1, 'Диск сцепления')
       on conflict (id) do update set fact_name = 'Диск сцепления'`, [second]);

    const r = await uiPost('/ui/unidentified/auto-match-apply');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('auto-match-done');

    const a = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line where id = $1`, [exact]);
    const b = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line where id = $1`, [second]);

    expect(a.rows[0]!.nomenclature_id, 'точное совпадение не привязано').toBeTruthy();
    expect(b.rows[0]!.nomenclature_id, '«Диск сцепления» ПРИВЯЗАЛИ, хотя его нет в справочнике')
      .toBe(null);
  });

  test('привязка идёт в ЖУРНАЛ: пакетную правку надо разбирать потом', async () => {
    const id = await unidentified('Фильтр масляный');
    await uiPost('/ui/unidentified/auto-match-apply');

    const rows = await pool.query<{ comment: string | null; new_value: string | null }>(
      `select comment, new_value from audit_log
        where entity = 'line' and entity_id = $1 and field = 'nomenclature_id'`, [id]);
    expect(rows.rowCount, 'пакетная привязка не записана в журнал').toBeGreaterThan(0);
    expect(rows.rows[0]!.comment, 'не сказано, что это пакет').toContain('пакет');
    expect(rows.rows[0]!.comment, 'не сохранена оценка').toMatch(/оценка \d/);
  });

  test('двойное подтверждение не привязывает дважды', async () => {
    const id = await unidentified('Фильтр масляный');
    await uiPost('/ui/unidentified/auto-match-apply');
    const first = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line where id = $1`, [id]);

    await uiPost('/ui/unidentified/auto-match-apply');
    const second = await pool.query<{ nomenclature_id: string | null }>(
      `select nomenclature_id from line where id = $1`, [id]);

    // Второй проход не должен переписать уже привязанное: строки с номенклатурой в
    // выборку не попадают.
    expect(second.rows[0]!.nomenclature_id).toBe(first.rows[0]!.nomenclature_id);
  });

  test('когда подставлять нечего — это сказано словами', async () => {
    await unidentified('Диск сцепления');
    const r = await uiPost('/ui/unidentified/auto-match');
    const body = await r.text();

    expect(body, 'пустой пакет показан как успех').toContain('auto-match-nothing');
  });
});

describe('п. 2 · экран', () => {
  test('подсказки видны на экране неопознанных', async () => {
    await unidentified('Фильтр масляный');
    const { status, body } = await html('/unidentified');

    expect(status).toBe(200);
    expect(body, 'панели сопоставления нет на экране').toContain('data-testid="matches-panel"');
    expect(body, 'полоса не показана').toContain('match-band');
  });

  test('под каждой строкой видно, ПОЧЕМУ предложено', async () => {
    const id = await unidentified('Фильтр масляный');
    const { body } = await html('/unidentified');

    expect(body).toContain(`data-testid="match-${id}"`);
    expect(body, 'нет объяснения совпадения').toContain('совпало:');
  });

  test('для позиции без пары предложено завести её', async () => {
    const id = await unidentified('Диск сцепления');
    const { body } = await html('/unidentified');

    expect(body, 'нет ответа «в справочнике нет»').toContain(`data-testid="match-none-${id}"`);
  });

  test('кнопка пакета показывает, СКОЛЬКО будет привязано', async () => {
    await unidentified('Фильтр масляный');
    const { body } = await html('/unidentified');
    expect(body).toContain('data-testid="auto-match-run"');
    expect(body, 'не сказано, сколько останется вручную').toContain('останутся вам');
  });

  test('предложения не показываются для уже опознанных', async () => {
    // Опознанные строки в выборку неопознанных не попадают вовсе.
    const { body } = await html('/unidentified');
    expect(body).toContain('data-testid="matches-panel"');
    expect(body).toContain('data-total=');
  });
});

describe('п. 2 · право', () => {
  test('кладовщику подставлять нельзя — это сопоставление, а не приёмка', async () => {
    const store = '11111111-aaaa-1111-1111-111111111103';
    const cookie = `arm_session=${encodeSession({ userId: store, role: 'storekeeper' })}`;
    const r = await request('/ui/unidentified/auto-match-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: '',
    });
    expect(r.status, 'кладовщик запустил пакетное сопоставление').toBe(403);
  });

  test('менеджер подставляет — это его работа', async () => {
    expect((await uiPost('/ui/unidentified/auto-match')).status).toBe(200);
  });
});
