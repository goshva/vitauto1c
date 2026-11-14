import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';
import { pool } from '../../src/db.ts';

// Роли (Q7): пять ролей и восемь проверок до приёмки — пять положительных
// и три на запрет.
//
// ПОЧЕМУ роль передаётся заголовком `X-Role`, а не входом с паролем: в прототипе
// аутентификации ещё нет (заказчик: «на старте один админ делает всё за всех»),
// и вход с паролем был бы третьей сущностью на ровном месте. Заголовок честно
// показывает, что ГРАНИЦА ПРАВ проверяется, а способ предъявления роли — ещё нет.
// Подделать заголовок тривиально; в прототипе это записано в отчёте как риск,
// а не спрятано.
//
// Без заголовка роль — `admin`: так работают все остальные 400+ тестов и демо
// «один админ за всех».

const CAR = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const SERVICE = '22222222-2222-2222-2222-222222222201';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';

type Role = 'admin' | 'municipality' | 'manager' | 'mechanic' | 'storekeeper';

const as = (role: Role) => ({ 'x-role': role });

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const get = (url: string, role?: Role) =>
  json(url, { headers: { accept: 'application/json', ...(role ? as(role) : {}) } });
const post = (url: string, body?: unknown, role?: Role) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(role ? as(role) : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const html = async (url: string, role?: Role) => {
  const r = await app.request(url, { headers: { accept: 'text/html', ...(role ? as(role) : {}) } });
  return { status: r.status, body: await r.text() };
};

/**
 * Лист клиента — вход в процесс «заявка → ремонт» (N1 → M1).
 *
 * Номер заявки — СЧЁТЧИК, а не `Math.random()`: при случайном номере повтор
 * прогона даёт другой результат, и «создано ровно одна заявка» перестаёт быть
 * проверкой.
 */
let sheetNo = 0;
const sheet = () => {
  sheetNo += 1;
  return {
    customerId: '66666666-6666-6666-6666-666666666601',
    clientOrderNumber: `З-${String(sheetNo).padStart(4, '0')}`,
    rows: [{ name: 'Масло моторное 5W-30', article: 'MOT5W30-5L', quantity: '2' }],
  };
};

async function openWorkOrder(): Promise<string> {
  const { body } = await post('/work-orders', { carId: CAR, serviceTypeId: SERVICE });
  return String(body.id);
}

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

// ═══ Пять положительных ════════════════════════════════════════════════════════════

describe('P1 · admin видит дашборд', () => {
  test('сводка открывается и показывает счётчики', async () => {
    const { status, body } = await html('/', 'admin');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-dashboard"');

    for (const id of ['dash-lines', 'dash-fleet-due', 'dash-invoices', 'dash-work-orders']) {
      expect(body, `нет счётчика ${id}`).toContain(`data-testid="${id}"`);
    }
  });

  test('счётчики отражают данные', async () => {
    const { body } = await html('/', 'admin');
    // На сиде справочников три машины требуют ТО, и это видно на дашборде.
    expect(body).toContain('data-testid="dash-fleet-due">3<');
  });
});

describe('P2 · municipality создаёт заявку', () => {
  test('лист клиента принимается и создаёт заказ', async () => {
    const { status, body } = await post('/imports', sheet(), 'municipality');
    expect(status, JSON.stringify(body)).toBe(201);

    const r = await pool.query<{ n: string }>(`select count(*)::text n from customer_order`);
    expect(Number(r.rows[0]!.n)).toBe(1);
  });
});

describe('P3 · manager видит заявку и остатки', () => {
  test('менеджер открывает список строк и видит заявку', async () => {
    const created = await post('/imports', sheet(), 'municipality');
    expect(created.status).toBe(201);

    const { status, body } = await get('/lines', 'manager');
    expect(status).toBe(200);
    expect((body.items as unknown[]).length).toBe(1);
  });

  test('менеджер видит остаток склада', async () => {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '5',
    }, 'storekeeper');

    const { status, body } = await get(`/stock/balance?nomenclatureId=${NOM}`, 'manager');
    expect(status).toBe(200);
    expect(Number((body.items as { on_hand: string }[])[0]!.on_hand)).toBe(5);
  });
});

describe('P4 · mechanic выполняет работу', () => {
  test('механик закрывает заказ-наряд', async () => {
    const id = await openWorkOrder();
    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'closed' }, 'mechanic');

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('closed');
  });

  test('механик добавляет работу в наряд', async () => {
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/labor`, {
      name: 'Замена масла', normHours: '1.5', salePrice: '1500',
    }, 'mechanic');
    expect(status).toBe(201);
  });
});

describe('P5 · storekeeper выдаёт запчасть', () => {
  test('кладовщик выдаёт запчасть — создаётся движение', async () => {
    const { status, body } = await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'write_off',
      quantity: '2', comment: 'Выдача в ремонт',
    }, 'storekeeper');

    expect(status, JSON.stringify(body)).toBe(201);

    const r = await pool.query<{ n: string }>(
      `select count(*)::text n from stock_move where kind = 'write_off'`);
    expect(Number(r.rows[0]!.n), 'движение выдачи не создано').toBe(1);
  });
});

// ═══ Три на запрет ═════════════════════════════════════════════════════════════════

describe('N1 · mechanic НЕ может создать заявку', () => {
  test('отказ 403 и объяснение, кому можно', async () => {
    const { status, body } = await post('/imports', sheet(), 'mechanic');

    expect(status).toBe(403);
    expect(body.code).toBe('forbidden');
    // Отказ обязан сказать, у кого есть право, — иначе непонятно, к кому идти.
    expect(String(body.message)).toContain('municipality');

    const r = await pool.query<{ n: string }>(`select count(*)::text n from customer_order`);
    expect(Number(r.rows[0]!.n), 'заявка всё-таки создана').toBe(0);
  });
});

describe('N2 · municipality НЕ может принять работу', () => {
  test('заказчик не закрывает наряд', async () => {
    const id = await openWorkOrder();
    const { status, body } = await post(`/work-orders/${id}/transition`, { to: 'closed' }, 'municipality');

    expect(status).toBe(403);
    expect(String(body.message)).toContain('mechanic');

    const r = await pool.query<{ status: string }>(`select status from work_order where id = $1`, [id]);
    expect(r.rows[0]!.status, 'наряд закрыт, хотя права не было').toBe('new');
  });
});

describe('N3 · manager НЕ может выполнить ремонт', () => {
  test('менеджер не закрывает наряд', async () => {
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/transition`, { to: 'closed' }, 'manager');
    expect(status).toBe(403);
  });

  test('менеджер не добавляет работу в наряд', async () => {
    const id = await openWorkOrder();
    const { status } = await post(`/work-orders/${id}/labor`, {
      name: 'Работа', normHours: '1',
    }, 'manager');
    expect(status).toBe(403);
  });
});

// ═══ Опоры механизма ══════════════════════════════════════════════════════════════

describe('механизм ролей', () => {
  test('без заголовка роль admin — «один админ делает всё за всех»', async () => {
    const { status } = await post('/imports', sheet());
    expect(status).toBe(201);
  });

  test('неизвестная роль отвергается со списком допустимых', async () => {
    // Значение заголовка — латиница: HTTP-заголовок не принимает кириллицу,
    // и попытка прислать «директор» падает до обработчика.
    const { status, body } = await post('/imports', sheet(), 'director' as Role);
    expect(status).toBe(400);
    expect(String(body.message)).toContain('storekeeper');
  });

  test('admin делает всё, что делают остальные роли', async () => {
    const sheet1 = await post('/imports', sheet(), 'admin');
    expect(sheet1.status).toBe(201);

    const id = await openWorkOrder();
    expect((await post(`/work-orders/${id}/transition`, { to: 'closed' }, 'admin')).status).toBe(200);
    expect((await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, kind: 'receipt', quantity: '1',
    }, 'admin')).status).toBe(201);
  });

  test('дашборд закрыт для остальных ролей', async () => {
    for (const role of ['mechanic', 'storekeeper', 'manager', 'municipality'] as Role[]) {
      const { status } = await html('/', role);
      expect(status, `${role} видит дашборд`).toBe(403);
    }
  });

  test('роли отдаются справочником — для экрана прав', async () => {
    const { body } = await get('/employees');
    const roles = body.roles as { role: string; title: string; duty: string }[];
    expect(roles.length).toBe(5);
    expect(roles.map((r) => r.role).sort()).toEqual(
      ['admin', 'manager', 'mechanic', 'municipality', 'storekeeper']);
    expect(roles.every((r) => r.duty.length > 0)).toBe(true);
  });
});
