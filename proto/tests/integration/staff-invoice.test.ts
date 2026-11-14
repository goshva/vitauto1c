import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedProcess, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Сотрудники (Q3, Q7), исполнитель работ (Q3) и счёт (Q6). Тесты до кода.
//
// Сотрудник — не роль: роль даёт права, а подпись в акте, выработка и история
// «кто закрыл наряд» требуют конкретного человека. Счёт — не бухгалтерия:
// только статус оплаты, без которого нельзя закрыть заказ.

const MECHANIC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04';
const MANAGER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03';
const ADMIN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
const STOREKEEPER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05';
const DEPT_TC = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const COUNTERPARTY = '66666666-6666-6666-6666-666666666601';

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const get = (url: string) => json(url, { headers: { accept: 'application/json' } });
const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Заказ покупателя из сида процесса happy — на него выставляем счёт. */
async function anyOrder(): Promise<{ id: string; total: string | null }> {
  const r = await pool.query<{ id: string; total: string | null }>(
    `select id, total::text from customer_order where deleted_at is null limit 1`,
  );
  return r.rows[0]!;
}

async function openWorkOrder(): Promise<string> {
  const { body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
  await seedProcess('happy');
});

describe('GET /employees — сотрудники', () => {
  test('отдаёт всех с ролью, подразделением и признаком подписи', async () => {
    const { status, body } = await get('/employees');
    expect(status).toBe(200);

    const items = body.items as {
      fullName: string; role: string; roleTitle: string;
      department: string | null; position: string | null; canSign: boolean;
    }[];
    expect(items.length).toBe(5);

    const mech = items.find((x) => x.fullName.startsWith('Петров'))!;
    expect(mech.role).toBe('mechanic');
    expect(mech.roleTitle, 'роль не переведена на русский').toBe('Механик');
    expect(mech.department).toBe('Транспортный цех');
    expect(mech.canSign, 'механик подписывает акт').toBe(true);
  });

  test('фильтр по роли', async () => {
    const all = await get('/employees');
    const mech = await get('/employees?role=mechanic');
    expect((mech.body.items as unknown[]).length).toBe(1);
    expect((mech.body.items as unknown[]).length).toBeLessThan((all.body.items as unknown[]).length);
  });

  test('фильтр по подразделению', async () => {
    const { body } = await get(`/employees?departmentId=${DEPT_TC}`);
    const items = body.items as { fullName: string }[];
    expect(items.length).toBe(2);
    expect(items.map((x) => x.fullName).sort()).toEqual(['Петров П. С.', 'Сидоров Н. П.']);
  });

  test('неизвестная роль → пустой список, а не все подряд', async () => {
    const { body } = await get('/employees?role=директор');
    expect((body.items as unknown[]).length).toBe(0);
  });

  test('есть те, кто может подписывать акт', async () => {
    const { body } = await get('/employees?canSign=true');
    const items = body.items as { canSign: boolean }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x) => x.canSign)).toBe(true);
  });
});

describe('исполнитель работ в заказ-наряде (Q3)', () => {
  test('работу можно записать на конкретного механика', async () => {
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/labor`, {
      name: 'Замена масла', normHours: '1.5', salePrice: '1500', executorId: MECHANIC,
    });
    expect(status).toBe(201);

    const { body: card } = await get(`/work-orders/${id}`);
    // Карточка отдаёт строки как есть, именами колонок БД.
    const labor = (card.labor as { executor: string | null; executor_id: string | null }[])[0]!;
    expect(labor.executor_id).toBe(MECHANIC);
    expect(labor.executor, 'в карточке нет имени исполнителя').toBe('Петров П. С.');
  });

  test('без исполнителя работа создаётся — наряд бывает и без назначения', async () => {
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/labor`, {
      name: 'Диагностика', normHours: '0.5',
    });
    expect(status).toBe(201);
  });

  test('менеджера в исполнители не записать — работу делает механик', async () => {
    const id = await openWorkOrder();
    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Работа', normHours: '1', executorId: MANAGER,
    });
    expect(status).toBe(400);
    expect(String(body.message)).toContain('не механик');
  });

  test('неизвестный исполнитель → 400 с именем поля', async () => {
    const id = await openWorkOrder();
    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Работа', normHours: '1', executorId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(status).toBe(400);
    expect(body.field).toBe('executorId');
  });

  test('кладовщика в исполнители не записать — работу делает механик', async () => {
    const id = await openWorkOrder();
    const { status, body } = await post(`/work-orders/${id}/labor`, {
      name: 'Работа', normHours: '1', executorId: STOREKEEPER,
    });
    expect(status).toBe(400);
    expect(String(body.message)).toContain('не механик');
  });

  test('администратора записать МОЖНО: он делает всё за всех', async () => {
    // Условие заказчика: на старте один администратор делает всё. Запрет на него
    // сломал бы демо — работу пришлось бы поручать механику, которого нет.
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/labor`, {
      name: 'Работа', normHours: '1', executorId: ADMIN,
    });
    expect(status).toBe(201);
  });
});

describe('GET /invoices — счета', () => {
  test('пустой список объясняется словами', async () => {
    const { status, body } = await get('/invoices');
    expect(status).toBe(200);
    expect(body.total).toBe(0);
  });

  test('счёт по заказу берёт сумму заказа', async () => {
    const order = await anyOrder();
    const { status, body } = await post('/invoices', { customerOrderId: order.id });

    expect(status).toBe(201);
    expect(body.status).toBe('draft');
    expect(body.kind).toBe('outgoing');
    expect(String(body.amount), 'сумма не взята из заказа').toBe(String(order.total));
  });

  test('счёт можно выставить без заказа, с суммой вручную', async () => {
    const { status, body } = await post('/invoices', {
      counterpartyId: COUNTERPARTY, amount: '5000.00', comment: 'Ремонт по заявке б/н',
    });
    expect(status).toBe(201);
    expect(body.amount).toBe('5000.00');
  });

  test('счёт по несуществующему заказу → 404', async () => {
    const { status } = await post('/invoices', {
      customerOrderId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(status).toBe(404);
  });

  test('фильтр по статусу', async () => {
    await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '100' });
    const draft = await get('/invoices?status=draft');
    const paid = await get('/invoices?status=paid');
    expect(draft.body.total).toBe(1);
    expect(paid.body.total).toBe(0);
  });
});

describe('оплата счёта (Q6)', () => {
  async function newInvoice(): Promise<string> {
    const { body } = await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '7777.00' });
    return String(body.id);
  }

  test('черновик → отправлен → оплачен, дата оплаты заполняется', async () => {
    const id = await newInvoice();

    const sent = await post(`/invoices/${id}/transition`, { to: 'sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent');

    const paid = await post(`/invoices/${id}/transition`, { to: 'paid' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.paidAt, 'дата оплаты не заполнена').toBeTruthy();
  });

  test('перескочить шаг нельзя: из черновика сразу в оплаченные', async () => {
    const id = await newInvoice();
    const { status, body } = await post(`/invoices/${id}/transition`, { to: 'paid' });

    expect(status).toBe(409);
    // Отказ обязан назвать, что доступно.
    expect(String(body.message)).toContain('Отправлен');
  });

  test('оплаченный счёт дальше не движется', async () => {
    const id = await newInvoice();
    await post(`/invoices/${id}/transition`, { to: 'sent' });
    await post(`/invoices/${id}/transition`, { to: 'paid' });

    const { status, body } = await post(`/invoices/${id}/transition`, { to: 'sent' });
    expect(status).toBe(409);
    expect(String(body.message)).toContain('дальше не движется');
  });

  test('неизвестное состояние отвергается со списком допустимых', async () => {
    const id = await newInvoice();
    const { status, body } = await post(`/invoices/${id}/transition`, { to: 'оплачен' });
    expect(status).toBe(400);
    expect(String(body.message)).toContain('draft');
  });

  test('несуществующий счёт → 404', async () => {
    const { status } = await post('/invoices/00000000-0000-0000-0000-0000000000ff/transition', { to: 'sent' });
    expect(status).toBe(404);
  });

  test('в списке видно состояние словами и признак оплаты', async () => {
    const id = await newInvoice();
    await post(`/invoices/${id}/transition`, { to: 'sent' });

    const { body } = await get('/invoices');
    const item = (body.items as { id: string; status: string; statusTitle: string; canPay: boolean }[])
      .find((x) => x.id === id)!;
    expect(item.statusTitle).toBe('Отправлен');
    expect(item.canPay, 'отправленный счёт можно оплатить').toBe(true);
  });
});
