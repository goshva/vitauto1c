import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: возвраты — 7 операций, состояние документа ОТДЕЛЬНО от состояния строки.
//
// Смысл проверки: статус СТРОКИ говорит, где товар, а состояние ВОЗВРАТА — где документ.
// Их смешение даёт «товар на складе, а возврат ещё не принят» — расхождение, которое
// находят на складе, а не в тесте.

const RETURN_LINE = 'b0000000-0000-0000-0000-000000000008'; // сид процесса return: shipped

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

const mark = (id: string) => post(`/lines/${id}/mark`, { marked: true });

const lineStatus = async (id: string): Promise<string> =>
  (await pool.query<{ s: string }>(`select status s from line where id = $1`, [id])).rows[0]!.s;

/** Отмечает строку и оформляет возврат. Возвращает его идентификатор. */
async function makeReturn(kind = 'client'): Promise<string> {
  await mark(RETURN_LINE);
  const { status, body } = await post('/returns', { kind });
  expect(status, JSON.stringify(body)).toBe(201);
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('return');
});

describe('POST /returns — оформление (N3)', () => {
  test('создаёт возврат и переводит строку в «Возврат»', async () => {
    await mark(RETURN_LINE);
    const { status, body } = await post('/returns', { kind: 'client' });

    expect(status).toBe(201);
    expect(String(body.number)).toMatch(/^ВЗ-\d{4}$/);
    expect(body.lines).toBe(1);
    expect(await lineStatus(RETURN_LINE), 'строка не перешла в возврат').toBe('return');
  });

  test('отметка снимается после оформления', async () => {
    await makeReturn();
    const r = await pool.query(`select 1 from line_mark where id = $1 and marked`, [RETURN_LINE]);
    expect(r.rowCount).toBe(0);
  });

  test('без отмеченных строк → 409 с понятным текстом', async () => {
    const { status, body } = await post('/returns', { kind: 'client' });
    expect(status).toBe(409);
    expect(body.code).toBe('nothing_marked');
    expect(String(body.message)).toContain('Отметьте строки');
  });

  test('вид возврата обязателен и проверяется схемой', async () => {
    await mark(RETURN_LINE);
    const { status, body } = await post('/returns', { kind: 'нетакого' });
    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });

  test('строку нельзя вернуть дважды', async () => {
    await makeReturn();
    await mark(RETURN_LINE);
    const { status } = await post('/returns', { kind: 'client' });
    expect(status, 'строка уже в возврате, повторный не должен пройти').toBe(409);
  });
});

describe('GET /returns — список и карточка', () => {
  test('список пуст, пока возвратов нет', async () => {
    const { status, body } = await get('/returns');
    expect(status).toBe(200);
    expect(body.total).toBe(0);
  });

  test('оформленный возврат виден в списке', async () => {
    const id = await makeReturn();
    const { body } = await get('/returns');
    const items = body.items as { id: string; kind: string; status: string }[];
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe(id);
    expect(items[0]!.kind).toBe('client');
    expect(items[0]!.status).toBe('new');
  });

  test('фильтр по виду различает три процесса возврата', async () => {
    await makeReturn('client');
    expect((await get('/returns?kind=client')).body.total).toBe(1);
    expect((await get('/returns?kind=supplier')).body.total).toBe(0);
    expect((await get('/returns?kind=internal')).body.total).toBe(0);
  });

  test('карточка отдаёт возврат вместе со строками', async () => {
    const id = await makeReturn();
    const { status, body } = await get(`/returns/${id}`);

    expect(status).toBe(200);
    expect((body.header as { id: string }).id).toBe(id);
    const lines = body.lines as { id: string; status: string }[];
    expect(lines.length).toBe(1);
    expect(lines[0]!.id).toBe(RETURN_LINE);
    expect(lines[0]!.status).toBe('return');
  });

  test('несуществующий возврат → 404', async () => {
    const { status, body } = await get('/returns/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
    expect(body.code).toBe('not_found');
  });
});

describe('движение возврата', () => {
  test('приём на склад меняет состояние документа И статус строки', async () => {
    const id = await makeReturn();
    const { status, body } = await post(`/returns/${id}/accept`);

    expect(status).toBe(200);
    expect(body.status).toBe('accepted');
    expect(body.lines).toBe(1);
    expect(await lineStatus(RETURN_LINE), 'товар не попал на склад').toBe('to_stock');
  });

  test('передача поставщику доступна только из «принят»', async () => {
    const id = await makeReturn();

    const early = await post(`/returns/${id}/supplier`);
    expect(early.status).toBe(409);
    expect(String(early.body.message)).toContain('Принят на склад'.slice(0, 6));

    await post(`/returns/${id}/accept`);
    const ok = await post(`/returns/${id}/supplier`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('to_supplier');
  });

  test('принять возврат дважды нельзя — причина конкретна', async () => {
    const id = await makeReturn();
    await post(`/returns/${id}/accept`);
    const again = await post(`/returns/${id}/accept`);

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('bad_transition');
    // Сообщение обязано быть на языке оператора: «Принят на склад», а не `accepted`.
    expect(String(again.body.message)).toContain('Принят на склад');
    expect(String(again.body.message), 'машинное имя просочилось в текст')
      .not.toContain('accepted');
  });

  test('закрытие возможно из «принят» и из «передан поставщику»', async () => {
    const a = await makeReturn();
    await post(`/returns/${a}/accept`);
    expect((await post(`/returns/${a}/close`)).status).toBe(200);
    expect(await lineStatus(RETURN_LINE)).toBe('closed');
  });

  test('закрытый возврат дальше не двигается', async () => {
    const id = await makeReturn();
    await post(`/returns/${id}/accept`);
    await post(`/returns/${id}/close`);

    const again = await post(`/returns/${id}/close`);
    expect(again.status).toBe(409);
    expect(String(again.body.message)).toContain('уже закрыт');
  });
});

describe('отмена возврата', () => {
  test('отмена возвращает строку в «Отгружен» и освобождает её', async () => {
    const id = await makeReturn();
    const { status, body } = await json(`/returns/${id}`, { method: 'DELETE' });

    expect(status).toBe(200);
    expect(body.released).toBe(1);
    expect(await lineStatus(RETURN_LINE), 'товар остался в статусе возврата').toBe('shipped');

    const link = await pool.query(`select return_id from line where id = $1`, [RETURN_LINE]);
    expect(link.rows[0]!.return_id, 'ссылка на возврат не снята').toBeNull();
  });

  test('после отмены строку можно вернуть снова', async () => {
    const id = await makeReturn();
    await json(`/returns/${id}`, { method: 'DELETE' });

    const again = await makeReturn();
    expect(again).toBeTruthy();
  });

  test('отменённый возврат исчезает из списка', async () => {
    const id = await makeReturn();
    await json(`/returns/${id}`, { method: 'DELETE' });
    expect((await get('/returns')).body.total).toBe(0);
  });

  test('закрытый возврат отменить нельзя', async () => {
    const id = await makeReturn();
    await post(`/returns/${id}/accept`);
    await post(`/returns/${id}/close`);

    const { status, body } = await json(`/returns/${id}`, { method: 'DELETE' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Закрытый возврат');
  });
});
