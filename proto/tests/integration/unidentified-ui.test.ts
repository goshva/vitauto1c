import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Экран неопознанных позиций (P2 №19). API было с самого начала, экрана не было:
// на него ссылалась модель, а оператор не мог сделать то, что описано в сценарии.
//
// Проверяется не «страница открылась», а что круг замкнулся: позицию видно, её
// можно опознать, и после опознания она уходит из списка.

const NOM = '77777777-7777-7777-7777-777777777701';
const ZONE_SM = '99999999-9999-9999-9999-999999999902';

const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};
const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

/** Строка без номенклатуры — это и есть неопознанная позиция. */
const firstUnidentified = async (): Promise<string> =>
  String((await pool.query<{ id: string }>(
    `select id from line where nomenclature_id is null and not deleted limit 1`)).rows[0]!.id);

const bindForm = (lineId: string, nomenclatureId: string, zoneId = '') =>
  app.request('/ui/unidentified/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ lineId, nomenclatureId, zoneId }).toString(),
  });

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  // Внепроцессные узлы дают три неопознанные строки с разными комментариями.
  await seedExtra.offProcess();
});

describe('GET /unidentified — экран', () => {
  test('открывается и показывает ждущие опознания позиции', async () => {
    const { status, body } = await html('/unidentified');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-unidentified"');
    expect(body).toContain('data-testid="unidentified-table"');
  });

  test('позиция показана так, как пришла: описание и артикул', async () => {
    const { body } = await html('/unidentified');
    // Из сида внепроцессных узлов.
    expect(body).toContain('Похоже на фильтр, фото 3');
    expect(body).toContain('Позиция без артикула');
  });

  test('сводка называет, сколько ждёт', async () => {
    const { body } = await html('/unidentified');
    expect(body).toContain('data-testid="unidentified-summary"');
    expect(body).toContain('Ждут опознания');
  });

  test('пустой список объясняется словами, а не пустой таблицей', async () => {
    await pool.query(`update line set nomenclature_id = $1 where nomenclature_id is null`, [NOM]);
    const { body } = await html('/unidentified');

    expect(body).toContain('data-testid="unidentified-empty"');
    expect(body).not.toContain('data-testid="unidentified-table"');
  });

  test('позиция С номенклатурой в список не попадает', async () => {
    const id = await firstUnidentified();
    await pool.query(`update line set nomenclature_id = $2 where id = $1`, [id, NOM]);

    const { body } = await html('/unidentified');
    expect(body, 'опознанная строка осталась в списке').not.toContain(`unidentified-${id}"`);
  });

  test('у каждой позиции есть форма привязки', async () => {
    const id = await firstUnidentified();
    const { body } = await html('/unidentified');

    expect(body).toContain(`data-testid="bind-nomenclature-${id}"`);
    expect(body).toContain(`data-testid="bind-submit-${id}"`);
    expect(body).toContain('hx-post="/ui/unidentified/bind"');
  });

  test('адрес остаётся общим: агент получает JSON, браузер — страницу', async () => {
    const asAgent = await json('/unidentified');
    expect(asAgent.status).toBe(200);
    expect(Array.isArray(asAgent.body.items), 'API сломан экраном').toBe(true);
  });
});

describe('опознание позиции (K8)', () => {
  test('привязка убирает позицию из списка и ставит номенклатуру', async () => {
    const id = await firstUnidentified();

    const res = await bindForm(id, NOM);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-testid="unidentified-message"');
    expect(body).toContain('опознана');

    const r = await pool.query<{ nomenclature_id: string }>(
      `select nomenclature_id from line where id = $1`, [id]);
    expect(r.rows[0]!.nomenclature_id, 'номенклатура не проставилась').toBe(NOM);
    expect(body, 'позиция осталась в списке').not.toContain(`unidentified-${id}"`);
  });

  test('можно указать зону — куда положить после опознания', async () => {
    const id = await firstUnidentified();
    await bindForm(id, NOM, ZONE_SM);

    const r = await pool.query<{ zone_id: string | null }>(
      `select zone_id from line where id = $1`, [id]);
    expect(r.rows[0]!.zone_id).toBe(ZONE_SM);
  });

  test('неизвестная номенклатура — причина на странице, а не молчание', async () => {
    const id = await firstUnidentified();
    const res = await bindForm(id, '00000000-0000-0000-0000-0000000000ff');

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('data-testid="unidentified-message"');
    expect(body, 'позиция пропала из списка без причины').toContain(`unidentified-${id}"`);
  });

  test('повторное опознание отвергается и позиция не подменяется', async () => {
    const id = await firstUnidentified();
    await bindForm(id, NOM);

    const res = await bindForm(id, '77777777-7777-7777-7777-777777777702');
    expect(res.status).toBe(409);

    const r = await pool.query<{ nomenclature_id: string }>(
      `select nomenclature_id from line where id = $1`, [id]);
    expect(r.rows[0]!.nomenclature_id, 'номенклатура подменилась').toBe(NOM);
  });
});

describe('навигация', () => {
  test('в панели есть пункт «Неопознанные»', async () => {
    const { body } = await html('/lines');
    expect(body).toContain('data-testid="nav-unidentified"');
    expect(body).toContain('href="/unidentified"');
  });

  test('пункт подсвечен, когда мы на экране', async () => {
    const { body } = await html('/unidentified');
    // Берём ВЕСЬ тег пункта, а не первые символы: `class="active"` стоит в конце,
    // после title и aria-label.
    const start = body.indexOf('<a href="/unidentified"');
    const tag = body.slice(start, body.indexOf('>', start));
    expect(tag, `тег пункта: ${tag}`).toContain('class="active"');
  });

  test('на другом экране пункт не подсвечен', async () => {
    const { body } = await html('/stock');
    const start = body.indexOf('<a href="/unidentified"');
    const tag = body.slice(start, body.indexOf('>', start));
    expect(tag, 'подсветка стоит на чужом экране').not.toContain('class="active"');
  });
});
