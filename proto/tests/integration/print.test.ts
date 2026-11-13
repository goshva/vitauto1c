import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 4: три печатные формы (решение Q4) отдают серверный HTML
// и отбирают строки ПО СТАТУСАМ вида печати.
//
// Главная проверка — не «страница открылась», а «в ведомость попали ровно те
// строки, что должны»: в legacy формы брали статусы из Go-карты, а подписи — из
// шаблона, и расхождение замечали уже на бумаге.

const HAPPY = 'b0000000-0000-0000-0000-000000000001';
const STOCK = 'b0000000-0000-0000-0000-000000000002';

const page = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text(), type: r.headers.get('content-type') ?? '' };
};

const setStatus = (id: string, status: string) =>
  pool.query(`update line set status = $2 where id = $1`, [id, status]);

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('виды печати', () => {
  test('сборочный лист: заголовок, таблица, подписи, без цен', async () => {
    await setStatus(HAPPY, 'assembly');
    const { status, body, type } = await page('/print/assembly_sheet');

    expect(status).toBe(200);
    expect(type).toContain('text/html');
    expect(body).toContain('data-testid="page-print-assembly_sheet"');
    expect(body).toContain('Сборочный лист');
    expect(body).toContain('data-testid="print-table"');
    expect(body).toContain('data-testid="print-signs"');
    expect(body, 'в сборочном листе цен быть не должно').not.toContain('Цена');
  });

  test('сборочный лист: колонки сборки есть', async () => {
    await setStatus(HAPPY, 'assembly');
    const { body } = await page('/print/assembly_sheet');
    expect(body).toContain('Собрано');
    expect(body).toContain('Дефект / недостача');
  });

  test('отгрузочная ведомость: цены и итог есть', async () => {
    await setStatus(HAPPY, 'ready_to_ship');
    const { body } = await page('/print/shipment_sheet');

    expect(body).toContain('Отгрузочная ведомость');
    expect(body).toContain('Цена');
    expect(body).toContain('data-testid="print-total"');
  });

  test('корректировка ведомости: своя форма и узел M19', async () => {
    await setStatus(HAPPY, 'return');
    const { body } = await page('/print/shipment_correction');
    expect(body).toContain('Корректировка отгрузочной ведомости');
    expect(body).toContain('M19');
  });

  test('неизвестный вид → 404 со списком допустимых', async () => {
    const { status, body } = await page('/print/нетакой');
    expect(status).toBe(404);
    expect(body).toContain('assembly_sheet');
    expect(body).toContain('shipment_sheet');
    expect(body).toContain('shipment_correction');
  });
});

describe('отбор строк по статусам', () => {
  test('в сборочный лист попадает reserve, но не попадает new', async () => {
    await setStatus(HAPPY, 'reserve');
    await setStatus(STOCK, 'new');

    const { body } = await page('/print/assembly_sheet');
    // Обе строки имеют одно fact-наименование «Фильтр …», различаем по количеству.
    expect(body).toContain('data-testid="print-row-1"');
    expect(body).toContain('data-testid="print-count">Всего строк: 1');
  });

  test('в отгрузочную ведомость попадают ready_to_ship и shipped', async () => {
    await setStatus(HAPPY, 'ready_to_ship');
    await setStatus(STOCK, 'shipped');

    const { body } = await page('/print/shipment_sheet');
    expect(body).toContain('Всего строк: 2');
  });

  test('в корректировку попадает только return', async () => {
    await setStatus(HAPPY, 'return');
    await setStatus(STOCK, 'closed');

    const { body } = await page('/print/shipment_correction');
    expect(body).toContain('Всего строк: 1');
  });

  test('пустой результат — форма без таблицы, с пояснением', async () => {
    await setStatus(HAPPY, 'new');
    await setStatus(STOCK, 'new');

    const { body } = await page('/print/shipment_sheet');
    expect(body).toContain('data-testid="print-empty"');
    expect(body).not.toContain('data-testid="print-table"');
  });
});

describe('свод и фильтр по заказу', () => {
  test('итог по количеству считается по строкам формы', async () => {
    await setStatus(HAPPY, 'ready_to_ship');
    const { body } = await page('/print/shipment_sheet');
    // У строки happy quantity = 1.
    expect(body).toContain('data-testid="print-qty-total">1<');
  });

  test('фильтр по заказу отбирает только его строки', async () => {
    await setStatus(HAPPY, 'ready_to_ship');
    await setStatus(STOCK, 'ready_to_ship');

    const all = await page('/print/shipment_sheet');
    expect(all.body).toContain('Всего строк: 2');

    const only = await page(`/print/shipment_sheet?order=a0000000-0000-0000-0000-00000000f001`);
    expect(only.body).toContain('Всего строк: 1');
  });

  test('POST /print совместим с legacy и даёт ту же форму', async () => {
    await setStatus(HAPPY, 'assembly');
    const r = await app.request('/print', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'assembly_sheet' }).toString(),
    });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('Сборочный лист');
    expect(body).toContain('data-testid="print-table"');
  });
});

describe('экранирование в бланке', () => {
  test('кавычки и скобки в заявке клиента не ломают форму', async () => {
    await setStatus(HAPPY, 'ready_to_ship');
    await pool.query(`update line_fact set fact_name = $2 where id = $1`, [HAPPY, '<b>Фильтр</b> & "масло"']);

    const { body } = await page('/print/shipment_sheet');
    expect(body).not.toContain('<b>Фильтр</b>');
    expect(body).toContain('&lt;b&gt;');
  });
});
