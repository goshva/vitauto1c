import { beforeEach, describe, expect, test } from 'bun:test';
import { request } from '../helpers/request.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';
import { encodeSession } from '../../src/session.ts';

// ЭКРАН отчётов. Расчёты и API уже проверены отдельно — здесь другое: что видит человек.
//
// ТРИ ВЕЩИ, РАДИ КОТОРЫХ ЭТИ ТЕСТЫ И НАПИСАНЫ:
//
//   1. УБЫТОК ВИДЕН. Отчёт, в котором убыточная продажа выглядит как обычная строка,
//      опаснее отсутствующего: по нему принимают решения;
//   2. ОГОВОРКА ПРО ЧАСТИЧНЫЕ ДАННЫЕ ЕСТЬ. Часть строк бывает без себестоимости, и без
//      оговорки цифру принимают за полную;
//   3. ОТКАЗ ОБЪЯСНЁН, А НЕ СПРЯТАН. Роль без права на себестоимость должна видеть, что
//      раздел есть и почему закрыт, — иначе решит, что отчёта нет или он сломан.

const admin = '11111111-aaaa-1111-1111-111111111101';
const manager = '11111111-aaaa-1111-1111-111111111102';
const store = '11111111-aaaa-1111-1111-111111111103';
const mechanic = '11111111-aaaa-1111-1111-111111111104';

const as = (id: string, role: string): string =>
  `arm_session=${encodeSession({ userId: id, role })}`;

const html = async (url: string, userId: string, role: string) => {
  const r = await request(url, {
    headers: { accept: 'text/html', cookie: as(userId, role) },
  });
  return { status: r.status, body: await r.text() };
};

/** Две продажи: прибыльная и УБЫТОЧНАЯ — вторая нужна, чтобы проверить показ убытка. */
async function twoSales(): Promise<void> {
  await pool.query(`delete from line where internal_order_number like 'ЭКР-%'`);

  const rows = [
    { i: 0, cost: '100', price: '200' },
    { i: 1, cost: '100', price: '50' },
  ];

  for (const { i, cost, price } of rows) {
    const orderId = `e0000000-0000-0000-0000-0000000${20000 + i}`;
    const shipmentId = `f0000000-0000-0000-0000-0000000${20000 + i}`;
    const lineId = `d0000000-0000-0000-0000-0000000${20000 + i}`;

    await pool.query(
      `insert into customer_order (id, number, date, operation, counterparty_id,
        contract_id, organization_id, total)
       values ($1, $2, current_date - 5, 'sale', '66666666-6666-6666-6666-666666666601',
               'ee000000-0000-0000-0000-000000000003',
               '55555555-5555-5555-5555-555555555501', 0)
       on conflict (id) do nothing`, [orderId, `ЭКР-${i}`]);

    await pool.query(
      `insert into shipment (id, number, date, status, operation, counterparty_id,
        customer_order_id, warehouse_id)
       values ($1, $2, current_date - 5, 'shipped', 'sale',
               '66666666-6666-6666-6666-666666666601', $3,
               '44444444-4444-4444-4444-444444444401') on conflict (id) do nothing`,
      [shipmentId, `ЭКР-ОТ-${i}`, orderId]);

    await pool.query(
      `insert into line (id, customer_order_id, operation, status, quantity,
        nomenclature_id, customer_id, contract_id, order_date, cost_price, sale_price,
        shipment_doc_id, internal_order_number)
       values ($1, $2, 'sale', 'closed', 1, '77777777-7777-7777-7777-777777777702',
               '66666666-6666-6666-6666-666666666601',
               'ee000000-0000-0000-0000-000000000003', current_date - 5, $3, $4, $5, $6)
       on conflict (id) do update
         set cost_price = excluded.cost_price, sale_price = excluded.sale_price,
             shipment_doc_id = excluded.shipment_doc_id`,
      [lineId, orderId, cost, price, shipmentId, `ЭКР-${i}`]);
  }
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
  await pool.query(`delete from line where internal_order_number like 'ЭКР-%'`);
});

describe('экран отчётов · доступ', () => {
  test('администратору и менеджеру открыт', async () => {
    expect((await html('/reports', admin, 'admin')).status).toBe(200);
    const m = await html('/reports', manager, 'manager');
    expect(m.status).toBe(200);
    expect(m.body, 'нет панели отчётов').toContain('data-testid="reports-panel"');
  });

  test('КЛАДОВЩИК ВИДИТ ЭКРАН, но раздел с себестоимостью закрыт и объяснён', async () => {
    const { status, body } = await html('/reports', store, 'storekeeper');
    expect(status, 'экран целиком закрыли — а зависшие строки ему нужны').toBe(200);

    // Вкладка есть: молча убранный раздел выглядел бы как «отчёта нет».
    expect(body, 'вкладки нет — раздел просто исчез').toContain('data-testid="report-tab-profitability"');
    expect(body, 'не сказано, почему закрыт').toContain('data-testid="report-denied"');
    expect(body, 'отказ без названия права').toContain('report.cost');
  });

  test('механику тоже закрыт раздел с себестоимостью', async () => {
    const { body } = await html('/reports', mechanic, 'mechanic');
    expect(body).toContain('data-testid="report-denied"');
  });

  test('но ЗАВИСШИЕ СТРОКИ кладовщику доступны', async () => {
    const { body } = await html('/reports?tab=stuck', store, 'storekeeper');
    // Строк может не быть вовсе — тогда панель говорит об этом словами. Проверяем
    // СМЫСЛ: отчёт открылся и не показал отказа.
    expect(body, 'нет ни таблицы, ни объяснения, что зависших нет')
      .toMatch(/data-testid="(stuck-table|stuck-empty)"/);
    expect(body, 'показали отказ вместо отчёта').not.toContain('data-testid="report-denied"');
  });

  test('вкладка закрытого раздела помечена', async () => {
    const { body } = await html('/reports', store, 'storekeeper');
    // Видно, что раздел ЕСТЬ и почему не открывается.
    expect(body, 'закрытая вкладка не помечена').toContain('(закрыт)');
  });
});

describe('экран отчётов · убыток не спрятан', () => {
  test('убыточная строка видна и подписана', async () => {
    await twoSales();
    const { body } = await html('/reports', manager, 'manager');

    // Выручка 250, себестоимость 200, прибыль 50: одна строка прибыльная, одна убыточная.
    // В СВОДНОЙ таблице убыток виден ЧИСЛОМ: отрицательный итог группы подсвечен, а
    // число убыточных строк стоит отдельной цифрой. Построчного списка с убытком на
    // экране нет — это следующий шаг, и здесь он не проверяется.
    expect(body, 'не показано число убыточных строк').toContain('data-testid="report-loss-lines"');
    expect(body, 'не сказано словом, что это убыток').toContain('Ниже себестоимости');
  });

  test('числа на экране совпадают с расчётом', async () => {
    await twoSales();
    const { body } = await html('/reports', manager, 'manager');

    // 200 + 50 = 250 выручка, 100 + 100 = 200 себестоимость, 50 прибыль.
    expect(body, 'выручка на экране неверна').toContain('>250.00<');
    expect(body, 'прибыль на экране неверна').toContain('>50.00<');
  });

  test('наценка отрицательна и не взята по модулю', async () => {
    // Одна строка: себестоимость 100, цена 50 → наценка -50 %.
    await twoSales();
    await pool.query(`delete from line where internal_order_number = 'ЭКР-0'`);
    const { body } = await html('/reports', manager, 'manager');
    expect(body, 'наценка взята по модулю или потеряна').toMatch(/-50\.0 %/);
  });
});

describe('экран отчётов · оговорки и пустота', () => {
  test('сказано, что вошли только состоявшиеся продажи', async () => {
    await twoSales();
    const { body } = await html('/reports', manager, 'manager');
    expect(body, 'нет оговорки о том, что вошло в расчёт').toContain('data-testid="report-note"');
    expect(body).toContain('состоявшиеся');
  });

  test('строки без себестоимости названы числом', async () => {
    await twoSales();
    await pool.query(
      `update line set cost_price = null where internal_order_number = 'ЭКР-0'`);
    const { body } = await html('/reports', manager, 'manager');
    expect(body, 'не сказано про строки без себестоимости').toContain('без себестоимости');
  });

  test('пустой отчёт объясняется словами, а не пустой таблицей', async () => {
    const { body } = await html('/reports?dateFrom=2000-01-01&dateTo=2000-01-02',
      manager, 'manager');
    expect(body, 'пустота выглядит как поломка').toContain('data-testid="report-none"');
    expect(body, 'не сказано, почему пусто').toMatch(/отгружены|отгруженные/);
  });

  test('период показывается только у доступного раздела', async () => {
    const open = await html('/reports', manager, 'manager');
    const closed = await html('/reports?tab=stuck', manager, 'manager');
    expect(open.body).toContain('data-testid="report-period"');
    // У зависших свой срок, а не период отгрузки.
    expect(closed.body, 'форма периода стоит у отчёта, где её нет').not.toContain('data-testid="report-period"');
  });
});

describe('экран отчётов · разрезы', () => {
  test('по позициям, заказчикам и месяцам', async () => {
    await twoSales();
    const { body } = await html('/reports', manager, 'manager');

    for (const id of ['by-nomenclature', 'by-customer', 'by-month']) {
      expect(body, `нет разреза «${id}»`).toContain(`data-testid="${id}"`);
    }
  });

  test('месяцы без продаж не показаны нулём', async () => {
    await twoSales();
    const { body } = await html('/reports', manager, 'manager');
    // В подписи разреза это сказано прямым текстом — иначе ноль приняли бы за спад.
    expect(body, 'не сказано про пустые месяцы').toContain('отсутствие данных');
  });
});

describe('экран отчётов · вход', () => {
  test('ссылка есть на дашборде', async () => {
    const { body } = await html('/', admin, 'admin');
    expect(body, 'входа в отчёты нет').toContain('data-testid="dash-reports"');
  });
});
