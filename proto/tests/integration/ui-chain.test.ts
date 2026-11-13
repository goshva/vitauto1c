import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 3: сквозная цепочка happy проходит через ЭКРАН, а не только через API.
//
// Это и есть вертикальный срез: каждый шаг — HTTP-запрос к HTMX-маршруту,
// ответ — HTML, и статус читается из возвращённой разметки. Если шаг не проходит
// здесь, в браузере он не пройдёт тоже.

const CELL = '88888888-8888-8888-8888-888888888802';

const form = (url: string, data: Record<string, string> = {}) =>
  app.request(url, {
    method: 'POST',
    headers: {
      accept: 'text/html',
      'hx-request': 'true',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(data).toString(),
  });

/** Идентификатор единственной (или первой) строки из возвращённой панели. */
function firstRowId(html: string): string {
  const m = /data-testid="row-([0-9a-f-]{36})"/i.exec(html);
  if (!m) throw new Error('в панели нет ни одной строки');
  return m[1]!;
}

/** Статус строки по её data-testid в возвращённой панели. */
function statusOf(html: string, id: string): string {
  const re = new RegExp(`data-testid="row-${id}"[^>]*data-status="([a-z_]+)"`);
  const m = re.exec(html);
  if (!m) throw new Error(`строка ${id} не найдена в панели`);
  return m[1]!;
}

const toggle = (id: string) => form(`/ui/lines/${id}/toggle`);
const statusInDb = async (id: string) =>
  String((await pool.query<{ s: string }>(`select status s from line where id = $1`, [id])).rows[0]!.s);

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('цепочка happy целиком через экран', () => {
  test('от загрузки листа до «Закрыт» — 9 действий в браузере', async () => {
    // 1. N1/M1 — загрузка листа через форму.
    const imported = await (await form('/ui/lines/import', {
      name: 'Фильтр масляный', qty: '1', article: 'FLT-OIL-001', unit: 'шт', clientNumber: 'ЭКРАН-1',
    })).text();
    const id = firstRowId(imported);
    expect(statusOf(imported, id)).toBe('new');
    expect(imported).toContain('ЭКРАН-1');

    // 2. M4 — задание «В работе»: закупка у поставщика.
    await toggle(id);
    const afterJob = await (await form('/ui/lines/job', {})).text();
    expect(statusOf(afterJob, id)).toBe('ordered');

    // 3. M7 — оплата через канбан снабжения.
    await toggle(id);
    const afterPaid = await (await form('/ui/lines/supply', { status: 'paid' })).text();
    expect(statusOf(afterPaid, id)).toBe('paid');

    // 4. P2 — в пути.
    await toggle(id);
    const afterTransit = await (await form('/ui/lines/supply', { status: 'in_transit' })).text();
    expect(statusOf(afterTransit, id)).toBe('in_transit');

    // 5. K1 — приёмка по УПД (канбан, а не кнопка перехода).
    await toggle(id);
    const afterAccept = await (await form('/ui/lines/supply', { status: 'acceptance' })).text();
    expect(statusOf(afterAccept, id)).toBe('acceptance');

    // 6. K2 — размещение в ячейке.
    await toggle(id);
    const afterCell = await (await form('/ui/lines/cell', { cellId: CELL })).text();
    expect(afterCell).not.toContain('data-testid="cell-error"');
    expect(await statusInDb(id)).toBe('acceptance');

    // 7. M9 — на комплектацию.
    await toggle(id);
    const afterAssembly = await (await form('/ui/lines/transition', { to: 'assembly' })).text();
    expect(statusOf(afterAssembly, id)).toBe('assembly');

    // 8. K3 — собрано.
    await toggle(id);
    const afterReady = await (await form('/ui/lines/transition', { to: 'ready_to_ship' })).text();
    expect(statusOf(afterReady, id)).toBe('ready_to_ship');

    // 9. M15 — закрытие. Из ready_to_ship галка не требуется.
    await toggle(id);
    const afterClosed = await (await form('/ui/lines/transition', { to: 'closed' })).text();
    expect(statusOf(afterClosed, id)).toBe('closed');

    expect(await statusInDb(id), 'статус в базе должен совпасть с экраном').toBe('closed');
  });

  test('на каждом шаге кнопки пересчитаны под текущий статус', async () => {
    const imported = await (await form('/ui/lines/import', { name: 'Фильтр салонный' })).text();
    const id = firstRowId(imported);

    // В new доступен резерв, недоступна комплектация.
    const atNew = await (await toggle(id)).text();
    expect(atNew).toContain('data-testid="action-reserve"');
    expect(atNew).not.toContain('data-testid="action-assembly"');

    // Переводим в reserve. Отметки при этом снимаются — это правильно:
    // оператор отмечает строки заново перед следующим действием.
    const afterTransition = await (await form('/ui/lines/transition', { to: 'reserve' })).text();
    expect(afterTransition).toContain('data-count="0"');
    expect(afterTransition, 'без отметок кнопок нет').not.toContain('data-testid="action-assembly"');

    // Отмечаем снова — теперь видно, что набор кнопок сменился.
    const atReserve = await (await toggle(id)).text();
    expect(atReserve).not.toContain('data-testid="action-reserve"');
    expect(atReserve).toContain('data-testid="action-assembly"');
  });

  test('ошибка ячейки видна оператору, а не проглатывается', async () => {
    const imported = await (await form('/ui/lines/import', { name: 'Фильтр салонный' })).text();
    const id = firstRowId(imported);
    await toggle(id);

    const body = await (await form('/ui/lines/cell', { cellId: '00000000-0000-0000-0000-0000000000ff' })).text();
    expect(body).toContain('data-testid="cell-error"');
    expect(body).toContain('Ячейка не найдена');
  });

  test('пустое наименование при загрузке отвергается с подсказкой', async () => {
    const body = await (await form('/ui/lines/import', { name: '   ' })).text();
    expect(body).toContain('data-testid="import-error"');
    expect(body).toContain('Укажите наименование');
  });

  test('канбан из неподходящего статуса ничего не меняет', async () => {
    const imported = await (await form('/ui/lines/import', { name: 'Фильтр салонный' })).text();
    const id = firstRowId(imported);
    await toggle(id);

    // Из new нельзя сразу в paid.
    const body = await (await form('/ui/lines/supply', { status: 'paid' })).text();
    expect(statusOf(body, id), 'статус не должен измениться').toBe('new');
  });
});
