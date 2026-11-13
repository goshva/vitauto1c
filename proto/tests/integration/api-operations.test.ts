import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { resetTo, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Гейт этапа 2: операции вне переходов (загрузка листа, ячейка, канбан, задание)
// и сквозная цепочка happy на уровне API.
//
// Цепочка проверяется здесь ДО UI (этап 3): если она не проходит по API,
// в HTMX её искать нечего.

const CUSTOMER = '66666666-6666-6666-6666-666666666601';
const CONTRACT = 'ee000000-0000-0000-0000-000000000003';
const ORG = '55555555-5555-5555-5555-555555555501';
const CELL = '88888888-8888-8888-8888-888888888802';
const BLOCKED_CELL = '88888888-8888-8888-8888-888888888804';

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await seedRefs();
  await resetTo('happy');
  await seedProcess('stock');
});

describe('POST /imports — N1 → M1, первый шаг каждого процесса', () => {
  test('создаёт заказ, строки и заявку «как написал клиент»', async () => {
    const r = await post('/imports', {
      customerId: CUSTOMER,
      contractId: CONTRACT,
      organizationId: ORG,
      rows: [
        { article: 'FLT-OIL-001', name: 'Фильтр масляный', qty: '2', unit: 'шт', vehiclePlate: 'А123ВС777', clientNumber: 'ИМП-1' },
        { name: 'Масло моторное', qty: '1' },
      ],
    });
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.lineIds as string[]).toHaveLength(2);
    expect(String(b.number)).toMatch(/^ЗК-\d{4}$/);

    // Строки в new, факт заявки на месте, отметка снята.
    const line = await json(await app.request(`/lines/${(b.lineIds as string[])[0]}`));
    expect(line.status).toBe('new');
    expect(line.factName).toBe('Фильтр масляный');
    expect(line.clientOrderNumber).toBe('ИМП-1');
    expect(line.marked).toBe(false);
  });

  test('неизвестный заказчик → 400 с именем поля', async () => {
    const r = await post('/imports', {
      customerId: '00000000-0000-0000-0000-0000000000ff',
      rows: [{ name: 'Что-то' }],
    });
    expect(r.status).toBe(400);
    const b = await json(r);
    expect(b.code).toBe('bad_request');
    expect(b.field).toBe('customerId');
  });

  test('пустой список строк отвергается схемой', async () => {
    const r = await post('/imports', { customerId: CUSTOMER, rows: [] });
    expect(r.status).toBe(400);
  });
});

describe('POST /lines/{id}/cell — K2', () => {
  test('размещает строку и возвращает код ячейки', async () => {
    const r = await post(`/lines/b0000000-0000-0000-0000-000000000001/cell`, { cellId: CELL });
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.cell).toBe('A-01');
    expect(Number(b.version)).toBeGreaterThan(1);
  });

  test('заблокированная ячейка → 400', async () => {
    await pool.query(`update storage_cell set blocked = true where id = $1`, [BLOCKED_CELL]);
    const r = await post(`/lines/b0000000-0000-0000-0000-000000000001/cell`, { cellId: BLOCKED_CELL });
    expect(r.status).toBe(400);
    expect(String((await json(r)).message)).toContain('заблокирована');
  });

  test('несуществующая ячейка → 400', async () => {
    const r = await post(`/lines/b0000000-0000-0000-0000-000000000001/cell`, {
      cellId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /sales/jobs — M4/K5, задание без 1С', () => {
  test('переводит отмеченные строки в «Заказано» и создаёт заказ поставщику', async () => {
    await post(`/lines/b0000000-0000-0000-0000-000000000001/mark`, { marked: true });

    const r = await post('/sales/jobs', { allowSplit: false });
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.processed).toBe(1);
    expect(b.state).toBe('done');
    expect(b.supplierOrderId, 'должен создаться заказ поставщику').toBeTruthy();

    const line = await json(await app.request(`/lines/b0000000-0000-0000-0000-000000000001`));
    expect(line.status).toBe('ordered');
    expect(line.marked).toBe(false);
  });

  test('без отметок → 409', async () => {
    const r = await post('/sales/jobs', {});
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe('nothing_marked');
  });
});

describe('POST /supply/status — M7, P2', () => {
  test('цепочка снабжения: ordered → paid → in_transit', async () => {
    const line = 'b0000000-0000-0000-0000-000000000001';
    await post(`/lines/${line}/mark`, { marked: true });
    await post('/sales/jobs', {});
    expect((await json(await app.request(`/lines/${line}`))).status).toBe('ordered');

    await post(`/lines/${line}/mark`, { marked: true });
    const paid = await json(await post('/supply/status', { status: 'paid' }));
    expect(paid.processed).toBe(1);
    expect((await json(await app.request(`/lines/${line}`))).status).toBe('paid');

    await post(`/lines/${line}/mark`, { marked: true });
    const transit = await json(await post('/supply/status', { status: 'in_transit' }));
    expect(transit.processed).toBe(1);
    expect((await json(await app.request(`/lines/${line}`))).status).toBe('in_transit');
  });

  test('из неподходящего статуса — конкретная причина', async () => {
    const line = 'b0000000-0000-0000-0000-000000000001'; // new
    await post(`/lines/${line}/mark`, { marked: true });
    const r = await json(await post('/supply/status', { status: 'paid' }));
    expect(r.processed).toBe(0);
    expect((r.skipped as string[])[0]).toContain('не переходит в «paid»');
  });
});

describe('сквозная цепочка happy по API', () => {
  test('от листа до «Закрыт» — 10 шагов без 1С и без UI', async () => {
    // 1. N1/M1 — загрузка листа.
    const imp = await json(await post('/imports', {
      customerId: CUSTOMER, contractId: CONTRACT, organizationId: ORG,
      rows: [{ article: 'FLT-OIL-001', name: 'Фильтр масляный', qty: '1', clientNumber: 'ХЭППИ-1' }],
    }));
    const line = (imp.lineIds as string[])[0]!;
    expect((await json(await app.request(`/lines/${line}`))).status).toBe('new');

    const mark = () => post(`/lines/${line}/mark`, { marked: true });
    const status = async () => String((await json(await app.request(`/lines/${line}`))).status);

    // 2. M4 — задание: закупка у поставщика.
    await mark();
    expect((await json(await post('/sales/jobs', {}))).processed).toBe(1);
    expect(await status()).toBe('ordered');

    // 3. M7 — оплата.
    await mark();
    await post('/supply/status', { status: 'paid' });
    expect(await status()).toBe('paid');

    // 4. P2 — в пути.
    await mark();
    await post('/supply/status', { status: 'in_transit' });
    expect(await status()).toBe('in_transit');

    // 5. K1 — приёмка по УПД. В процессе happy приёмка идёт ПОСЛЕ «в пути»,
    //    а кнопка перехода `acceptance` в модели разрешена из `shipped`.
    //    Значит K1 здесь выполняется канбаном снабжения, а не кнопкой перехода.
    await mark();
    expect((await json(await post('/supply/status', { status: 'acceptance' }))).processed).toBe(1);
    expect(await status()).toBe('acceptance');

    // 6. K2 — размещение в ячейку.
    expect((await post(`/lines/${line}/cell`, { cellId: CELL })).status).toBe(200);

    // 7. M9 — на комплектацию (переход).
    await mark();
    expect((await json(await post('/lines/transition', { to: 'assembly' }))).processed).toBe(1);
    expect(await status()).toBe('assembly');

    // 8. K3/M11 — собрано (переход).
    await mark();
    expect((await json(await post('/lines/transition', { to: 'ready_to_ship' }))).processed).toBe(1);
    expect(await status()).toBe('ready_to_ship');

    // 9. M15/K7 — закрытие. Из ready_to_ship галка не требуется (C22).
    await mark();
    const closed = await json(await post('/lines/transition', { to: 'closed' }));
    expect(closed.processed).toBe(1);
    expect(await status()).toBe('closed');
  });
});

describe('Idempotency-Key', () => {
  test('повтор с тем же ключом не создаёт второй заказ', async () => {
    const body = {
      customerId: CUSTOMER, contractId: CONTRACT, organizationId: ORG,
      rows: [{ name: 'Фильтр масляный', qty: '1', clientNumber: 'ИДЕМ-1' }],
    };
    const key = 'idem-test-001';

    const first = await post('/imports', body, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    const firstBody = await json(first);

    const second = await post('/imports', body, { 'idempotency-key': key });
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replay')).toBe('true');
    expect(await json(second)).toEqual(firstBody);

    const orders = await pool.query(`select 1 from customer_order where client_order_number = 'ИДЕМ-1'`);
    expect(orders.rowCount, 'повтор создал второй заказ').toBe(1);
  });

  test('разные ключи создают разные заказы', async () => {
    const body = {
      customerId: CUSTOMER, contractId: CONTRACT, organizationId: ORG,
      rows: [{ name: 'Фильтр масляный', qty: '1', clientNumber: 'ИДЕМ-2' }],
    };
    await post('/imports', body, { 'idempotency-key': 'idem-a' });
    await post('/imports', body, { 'idempotency-key': 'idem-b' });

    const orders = await pool.query(`select 1 from customer_order where client_order_number = 'ИДЕМ-2'`);
    expect(orders.rowCount).toBe(2);
  });

  test('без ключа повтор создаёт второй заказ — ключ обязателен для защиты', async () => {
    const body = {
      customerId: CUSTOMER, contractId: CONTRACT, organizationId: ORG,
      rows: [{ name: 'Фильтр масляный', qty: '1', clientNumber: 'БЕЗ-КЛЮЧА' }],
    };
    await post('/imports', body);
    await post('/imports', body);
    const orders = await pool.query(`select 1 from customer_order where client_order_number = 'БЕЗ-КЛЮЧА'`);
    expect(orders.rowCount).toBe(2);
  });
});
