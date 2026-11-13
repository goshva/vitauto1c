import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 3: экран отдаёт HTML, действия работают через HTMX, а кнопки
// строятся из ТОЙ ЖЕ таблицы переходов, что проверяет API.
//
// Главная проверка — №6: кнопка недопустимого перехода НЕ появляется.
// В legacy таблица была продублирована четырежды, кнопка `reserve` показывалась
// для `partially_ordered`, а бэкенд строку молча пропускал (C21).

const HAPPY = 'b0000000-0000-0000-0000-000000000001';

const html = (url: string, init: RequestInit = {}) =>
  app.request(url, { ...init, headers: { accept: 'text/html', ...(init.headers ?? {}) } });

const form = (url: string, data: Record<string, string>) =>
  app.request(url, {
    method: 'POST',
    headers: {
      accept: 'text/html',
      'hx-request': 'true',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(data).toString(),
  });

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('GET /lines — один адрес, два представления', () => {
  test('браузер получает HTML-страницу', async () => {
    const r = await html('/lines');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const body = await r.text();
    expect(body).toContain('data-testid="page-lines"');
    expect(body).toContain('data-testid="lines-table"');
    expect(body).toContain('htmx.min.js');
  });

  test('агент получает JSON — API не сломан', async () => {
    const r = await app.request('/lines', { headers: { accept: 'application/json' } });
    expect(r.headers.get('content-type')).toContain('application/json');
    const b = (await r.json()) as { items: unknown[] };
    expect(Array.isArray(b.items)).toBe(true);
  });

  test('страница содержит засеянную строку с её тестовым идентификатором', async () => {
    const body = await (await html('/lines')).text();
    expect(body).toContain(`data-testid="row-${HAPPY}"`);
    expect(body).toContain('ЗК-HAPPY-1');
    expect(body).toContain('Фильтр масляный');
  });

  test('клиентский номер и факт-наименование попадают на экран', async () => {
    const body = await (await html('/lines')).text();
    expect(body).toContain('ИП Иванов');
  });
});

describe('отметка строки', () => {
  test('переключатель ставит отметку и возвращает панель', async () => {
    const r = await form(`/ui/lines/${HAPPY}/toggle`, {});
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('data-testid="lines-panel"');
    expect(body).toContain(`data-testid="mark-${HAPPY}" checked`);
    expect(body).toContain('data-count="1"');
  });

  test('повторный клик снимает отметку', async () => {
    await form(`/ui/lines/${HAPPY}/toggle`, {});
    const body = await (await form(`/ui/lines/${HAPPY}/toggle`, {})).text();
    expect(body).toContain('data-count="0"');
    expect(body).not.toContain(`data-testid="mark-${HAPPY}" checked`);
  });

  test('несуществующая строка → 404', async () => {
    const r = await form('/ui/lines/00000000-0000-0000-0000-0000000000ff/toggle', {});
    expect(r.status).toBe(404);
  });
});

describe('кнопки строятся из единой таблицы переходов', () => {
  test('для статуса new есть кнопка «Зарезервировать»', async () => {
    // Ровно ОДНО переключение: второе сняло бы отметку и кнопки исчезли.
    const body = await (await form(`/ui/lines/${HAPPY}/toggle`, {})).text();
    expect(body).toContain('data-testid="action-reserve"');
  });

  test('для new НЕТ кнопки «Собрано» — переход недоступен', async () => {
    const body = await (await form(`/ui/lines/${HAPPY}/toggle`, {})).text();
    expect(body).not.toContain('data-testid="action-ready_to_ship"');
  });

  test('после резерва кнопка «Зарезервировать» исчезает (C21 закрыт по построению)', async () => {
    // Ставим статус reserve и смотрим панель.
    await pool.query(`update line set status = 'reserve' where id = $1`, [HAPPY]);
    const body = await (await form(`/ui/lines/${HAPPY}/toggle`, {})).text();

    expect(body, 'кнопка reserve не должна показываться из reserve').not.toContain('data-testid="action-reserve"');
    expect(body, 'из reserve доступна комплектация').toContain('data-testid="action-assembly"');
  });

  test('без отметок кнопок нет, есть подсказка', async () => {
    const body = await (await html('/lines')).text();
    expect(body).toContain('data-count="0"');
    expect(body).toContain('Отметьте строки');
    expect(body).not.toContain('data-testid="action-reserve"');
  });
});

describe('переход через HTMX', () => {
  test('резерв меняет статус в возвращённой панели', async () => {
    await form(`/ui/lines/${HAPPY}/toggle`, {});
    const body = await (await form('/ui/lines/transition', { to: 'reserve' })).text();

    expect(body).toContain('data-status="reserve"');
    expect(body).toContain('Резерв');
    expect(body, 'после перехода отметка снимается').toContain('data-count="0"');
  });

  test('после резерва кнопки пересчитаны: комплектация есть, резерва нет', async () => {
    await form(`/ui/lines/${HAPPY}/toggle`, {});
    const body = await (await form('/ui/lines/transition', { to: 'reserve' })).text();
    expect(body).not.toContain('data-testid="action-reserve"');
  });

  test('закрытие отгруженной строки без галки не проходит (C22)', async () => {
    await pool.query(`update line set status = 'shipped', signed_original = false where id = $1`, [HAPPY]);
    await form(`/ui/lines/${HAPPY}/toggle`, {});
    const body = await (await form('/ui/lines/transition', { to: 'closed' })).text();

    const row = /data-status="([a-z_]+)"/.exec(body);
    expect(row?.[1], 'статус не должен измениться без галки').toBe('shipped');
  });
});

describe('экранирование', () => {
  test('угловые скобки в заявке клиента не ломают разметку', async () => {
    await pool.query(`update line_fact set fact_name = $2 where id = $1`, [
      HAPPY,
      '<script>alert(1)</script> & "кавычки"',
    ]);
    const body = await (await html('/lines')).text();

    expect(body, 'сырой тег не должен попасть в разметку').not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
    expect(body).toContain('&amp;');
  });
});

describe('статика отдаётся локально', () => {
  // Регрессия: `serveStatic({root:'./public'})` без rewriteRequestPath искал
  // `public/static/app.css` и отдавал 404 — страница при этом выглядела рабочей,
  // но HTMX не загружался и клики не работали.
  test('таблица стилей', async () => {
    const r = await app.request('/static/app.css');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/css');
    expect((await r.text()).length).toBeGreaterThan(100);
  });

  test('HTMX лежит локально, а не тянется из сети', async () => {
    const r = await app.request('/static/htmx.min.js');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
    const body = await r.text();
    expect(body.length).toBeGreaterThan(10_000);
    expect(body, 'прототип обязан работать без сети').not.toContain('cdn.');
  });
});

describe('фильтр продажи/закупки', () => {
  test('переключатель вида возвращает панель нужной операции', async () => {
    const sales = await (await html('/ui/lines/panel?view=sales')).text();
    expect(sales).toContain('data-view="sale"');

    const purchases = await (await html('/ui/lines/panel?view=purchases')).text();
    expect(purchases).toContain('data-view="purchase"');
  });
});
