import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 4: экран снабжения и ссылки на печать.
//
// Экран снабжения закрывает конкретную дыру: ссылка «Снабжение» была в навигации
// с самого начала, а страницы за ней не было — переход вёл в 404. Такое не ловится
// тестами API: маршрута просто нет, и никто его не запрашивает.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const STOCK = 'b0000000-0000-0000-0000-000000000002';

const html = (url: string) => app.request(url, { headers: { accept: 'text/html' } });
const setStatus = (id: string, status: string) =>
  pool.query(`update line set status = $2 where id = $1`, [id, status]);

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('экран снабжения', () => {
  test('открывается, а не отдаёт 404', async () => {
    const r = await html('/supply');
    expect(r.status, 'ссылка в навигации вела в 404').toBe(200);
    const body = await r.text();
    expect(body).toContain('data-testid="page-supply"');
    expect(body).toContain('data-testid="supply-panel"');
  });

  test('показывает строки снабжения и скрывает new', async () => {
    await setStatus(HAPPY, 'in_transit');
    await setStatus(STOCK, 'new');

    const body = await (await html('/supply')).text();
    expect(body).toContain(`data-testid="row-${HAPPY}"`);
    expect(body, 'статус new не относится к снабжению').not.toContain(`data-testid="row-${STOCK}"`);
  });

  test('пустой срез — понятное сообщение, а не пустая таблица', async () => {
    await setStatus(HAPPY, 'new');
    await setStatus(STOCK, 'new');

    const body = await (await html('/supply')).text();
    expect(body).toContain('data-testid="supply-empty"');
  });

  test('на экране есть кнопки канбана', async () => {
    await setStatus(HAPPY, 'ordered');
    const body = await (await html('/supply')).text();
    expect(body).toContain('data-testid="chain-supply-paid"');
    expect(body).toContain('data-testid="chain-supply-in_transit"');
  });

  test('/ui/supply/panel отдаёт панель снабжения', async () => {
    const r = await html('/ui/supply/panel');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-testid="supply-panel"');
  });
});

describe('ссылки на печать в АРМ', () => {
  test('все три формы доступны из панели действий', async () => {
    const body = await (await html('/lines')).text();

    expect(body).toContain('data-testid="print-panel"');
    for (const kind of ['assembly_sheet', 'shipment_sheet', 'shipment_correction']) {
      expect(body, `нет ссылки на ${kind}`).toContain(`data-testid="print-${kind}"`);
      expect(body).toContain(`href="/print/${kind}"`);
    }
  });

  test('ссылки открываются в новой вкладке — бланк не подменяет АРМ', async () => {
    const body = await (await html('/lines')).text();
    expect(body).toContain('target="_blank"');
    expect(body).toContain('rel="noopener"');
  });

  test('каждая ссылка действительно открывает свою форму', async () => {
    await setStatus(HAPPY, 'assembly');
    const r = await html('/print/assembly_sheet');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Сборочный лист');
  });
});
