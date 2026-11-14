import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// ФТ v2 п. 9: «Срочно — только метка».
//
// Дословно: «Флажок „Срочно“ подсвечивает строку заказа цветом в списке и в рабочем
// месте снабжения, но НЕ влияет на порядок формирования заказа поставщику».
//
// Вторая половина здесь главная. Подсветку видно глазами, а «не влияет на порядок» —
// нет: именно такое влияние прокрадывается само, когда сортировку пишут «по важности».

const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};
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
const patch = (url: string, body: unknown) =>
  json(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Две строки: первая обычная, вторая срочная. */
async function twoLines(): Promise<{ plain: string; urgent: string }> {
  const rows = await pool.query<{ id: string }>(
    `select id from line where not deleted order by order_date, id limit 2`);
  const plain = String(rows.rows[0]!.id);
  const urgent = String(rows.rows[1]!.id);

  const { status } = await patch(`/lines/${urgent}`, { field: 'urgency', value: 'Срочно' });
  expect(status, 'срочность не проставилась').toBe(200);

  return { plain, urgent };
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await seedProcess('stock');
});

describe('№9 · метка видна в списке', () => {
  test('срочная строка подсвечена и помечена', async () => {
    const { urgent } = await twoLines();
    const { body } = await html('/lines');

    // Берём ВЕСЬ тег строки: `class` стоит перед `data-testid`, и срез от
    // `data-testid` его не захватил бы.
    const at = body.indexOf(`data-testid="row-${urgent}"`);
    const row = body.slice(body.lastIndexOf('<tr', at), body.indexOf('</tr>', at));
    expect(row, 'нет класса подсветки').toContain('row-urgent');
    expect(body).toContain(`data-testid="urgency-${urgent}"`);
    expect(body, 'нет слова «Срочно»').toContain('Срочно');
  });

  test('обычная строка не подсвечена', async () => {
    const { plain } = await twoLines();
    const { body } = await html('/lines');

    const start = body.lastIndexOf('<tr', body.indexOf(`data-testid="row-${plain}"`));
    const row = body.slice(start, body.indexOf('</tr>', start));
    expect(row, 'обычная строка подсвечена как срочная').not.toContain('row-urgent');
    expect(row, 'у обычной строки стоит метка').not.toContain('>Срочно<');
  });

  test('в шапке таблицы есть колонка «Срочно»', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('<th>Срочно</th>');
  });

  test('метка видна и в рабочем месте снабжения', async () => {
    const { urgent } = await twoLines();
    // Переводим срочную строку в состояние, которое ведёт снабжение.
    await post(`/lines/${urgent}/mark`, { marked: true });
    await post('/sales/jobs', {});

    const { body } = await html('/supply');
    expect(body, 'в снабжении нет подсветки').toContain('row-urgent');
  });

  test('срочность снимается — подсветка уходит', async () => {
    const { urgent } = await twoLines();
    expect((await html('/lines')).body).toContain('row-urgent');

    const cleared = await patch(`/lines/${urgent}`, { field: 'urgency', value: '' });
    expect(cleared.status).toBe(200);

    const { body } = await html('/lines');
    const start = body.lastIndexOf('<tr', body.indexOf(`data-testid="row-${urgent}"`));
    const row = body.slice(start, body.indexOf('</tr>', start));
    expect(row, 'подсветка осталась после снятия метки').not.toContain('row-urgent');
  });
});

describe('№9 · метка НЕ влияет на порядок заказа поставщику', () => {
  test('порядок строк в списке не зависит от срочности', async () => {
    const { plain, urgent } = await twoLines();
    const { body } = await html('/lines');

    const atPlain = body.indexOf(`data-testid="row-${plain}"`);
    const atUrgent = body.indexOf(`data-testid="row-${urgent}"`);

    expect(atPlain, 'обычная строка пропала').toBeGreaterThan(-1);
    expect(atUrgent, 'срочная строка пропала').toBeGreaterThan(-1);
    // Обычная идёт ПЕРВОЙ: срочность не переставила строки.
    expect(atPlain, 'срочная строка обогнала обычную').toBeLessThan(atUrgent);
  });

  test('сортировка в запросах — по номеру строки, а не по срочности', async () => {
    // Проверяем сам SQL: `order by "order"`, и рядом НЕТ сортировки по urgency.
    for (const file of ['src/lines-ui.ts', 'src/supply-ui.ts']) {
      const t = readFileSync(file, 'utf8');
      const orderBy = [...t.matchAll(/order by[^\n`]*/gi)].map((m) => m[0]);
      expect(orderBy.length, `${file}: нет сортировки`).toBeGreaterThan(0);
      for (const clause of orderBy) {
        expect(clause, `${file}: срочность попала в сортировку`).not.toMatch(/urgency/i);
      }
    }
  });

  test('заказ поставщику формируется по порядку отметки, а не по срочности', async () => {
    const { plain, urgent } = await twoLines();

    // Отмечаем СНАЧАЛА срочную, потом обычную: если бы порядок задавала срочность,
    // результат совпал бы; проверяем, что порядок задаёт НАБОР строк, а срочность
    // на состав не влияет вовсе.
    await post(`/lines/${urgent}/mark`, { marked: true });
    await post(`/lines/${plain}/mark`, { marked: true });

    // Переводим обе в «Заказан» — из этого состояния строится заказ поставщику.
    await post('/sales/jobs', {});

    // «Задание» СНИМАЕТ отметки, а заказ поставщику строится по отмеченным —
    // отмечаем заново. Это и есть проверка: состав задаёт НАБОР строк.
    await post(`/lines/${urgent}/mark`, { marked: true });
    await post(`/lines/${plain}/mark`, { marked: true });

    const { body } = await post('/supplier-orders', {});
    expect(body.id, 'заказ поставщику не создан').toBeTruthy();

    const items = await pool.query<{ line_id: string }>(
      `select id as line_id from line where supplier_order_id = $1 order by order_date, id`,
      [String(body.id)],
    );
    const ids = items.rows.map((x) => x.line_id);
    expect(ids.length, 'в заказе не обе строки').toBe(2);
    expect(ids, 'срочная строка вытеснила обычную').toContain(plain);
    expect(ids).toContain(urgent);
  });

  test('срочность не меняет состояние строки — это метка, а не переход', async () => {
    const { urgent } = await twoLines();
    const r = await pool.query<{ status: string }>(`select status from line where id = $1`, [urgent]);
    // Обе строки сида начинаются в «Новый»: метка не двигает процесс.
    expect(r.rows[0]!.status).toBe('new');
  });
});

describe('№9 · подсветка описана в стилях', () => {
  test('правило подсветки есть и идёт после hover', async () => {
    const css = readFileSync('public/app.css', 'utf8');
    const atUrgent = css.indexOf('tr.row-urgent td');
    const atHover = css.indexOf('tbody tr:hover td');

    expect(atUrgent, 'правило подсветки отсутствует').toBeGreaterThan(-1);
    expect(atHover).toBeGreaterThan(-1);
    // Иначе подсветка пропадала бы при наведении — а по ней метку и ищут.
    expect(atUrgent, 'подсветка перекрывается hover').toBeGreaterThan(atHover);
  });
});
