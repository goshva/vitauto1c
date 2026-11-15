import { describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Число ячеек в строке обязано совпадать с числом заголовков.
//
// НАЙДЕННЫЙ ДЕФЕКТ: в шапке таблицы строк была колонка «Срочно», а в строке для неё
// ячейки не было. Колонки съезжали на одну — «Кол-во» показывалось под заголовком
// «Срочно», «Остаток» под «Кол-во», и так до конца. Глазами это выглядит как сдвиг
// таблицы, а в длинном списке заметить трудно.
//
// Поймал это только один тест, и то косвенно: он искал `data-testid="urgency-…"` и не
// находил. Отдельной проверки выравнивания не было вовсе. Здесь она есть.

async function page(): Promise<string> {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  const r = await app.request('/lines', { headers: { accept: 'text/html' } });
  return r.text();
}

/** Подписи заголовков таблицы строк. */
function headers(html: string): string[] {
  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

/** Ячейки ПЕРВОЙ строки таблицы. */
function firstRowCells(html: string): string[] {
  const table = html.slice(html.indexOf('data-testid="lines-table"'));
  const tbody = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
  const row = tbody.slice(tbody.indexOf('<tr'), tbody.indexOf('</tr>'));
  return [...row.matchAll(/<td[^>]*>/g)].map((m) => m[0]);
}

describe('таблица строк · колонки не съезжают', () => {
  test('заголовки и ячейки совпадают по числу', async () => {
    const html = await page();
    const th = headers(html);
    const td = firstRowCells(html);

    expect(th.length, 'заголовков не нашлось').toBeGreaterThan(10);
    expect(td.length, `заголовков ${th.length}, а ячеек ${td.length} — колонки съедут`)
      .toBe(th.length);
  });

  test('под каждой шапкой стоит своя ячейка', async () => {
    const html = await page();
    const th = headers(html);
    const td = firstRowCells(html);

    // Сопоставляем по порядку: значение под своим заголовком. Проверяем те пары,
    // у которых есть опознавательный признак в разметке.
    const pairs: [string, string][] = [
      ['Статус', 'data-testid="status-'],
      ['Срочно', 'data-testid="urgency-'],
      ['Заказ клиента', 'data-testid="client-number-'],
      ['Остаток', 'data-testid="stock-'],
    ];
    for (const [title, marker] of pairs) {
      const at = th.indexOf(title);
      expect(at, `заголовка «${title}» нет`).toBeGreaterThan(-1);
      expect(td[at], `в колонке «${title}» чужая ячейка`).toContain(marker);
    }
  });

  test('у срочной строки «Срочно» стоит в СВОЕЙ колонке', async () => {
    await seedRefs();
    await seedExtra.clear();
    await seedProcess('happy');

    // Срочную строку создаём сами: в сиде happy её нет, и проверка «под своим
    // заголовком» на прочерке ничего не докажет.
    await pool.query(
      `update line set urgency = 'Срочно'
        where id = (select id from line where not deleted order by id limit 1)`);

    const r = await app.request('/lines', { headers: { accept: 'text/html' } });
    const html = await r.text();

    const th = headers(html);
    const at = th.indexOf('Срочно');
    expect(at, 'заголовка «Срочно» н��т').toBeGreaterThan(-1);

    const rowAt = html.indexOf('class="line-row row-urgent"');
    expect(rowAt, 'срочной строки нет в списке').toBeGreaterThan(-1);
    const row = html.slice(html.lastIndexOf('<tr', rowAt), html.indexOf('</tr>', rowAt));

    // Ячейки ЦЕЛИКОМ, вместе с содержимым: разметка внутри тега `<td>` не даёт
    // увидеть, что в ячейке написано.
    const cells = [...row.matchAll(/<td[^>]*>[\s\S]*?<\/td>/g)].map((m) => m[0]);
    expect(cells.length, 'в срочной строке другое число ячеек').toBe(th.length);

    // И главное: слово «Срочно» обязано стоять в колонке «Срочно», а не в соседней.
    expect(cells[at], `в колонке «Срочно» стоит не срочность: ${cells[at]?.slice(0, 60)}`)
      .toContain('Срочно');
  });
});
