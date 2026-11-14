import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../src/server.ts';
import { seedExtra, seedRefs } from '../../db/seed.ts';

// Экраны автопарка, счетов и склада (Q2, Q6). Тесты до реализации.
//
// Проверяется не «страница открылась», а что оператор ВИДИТ нужное: причину ТО
// словами, состояние счёта, остаток с местом хранения. Экран, где всё это надо
// додумывать, бесполезен.

const CAR_DUE_KM = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
const NOM = '77777777-7777-7777-7777-777777777701';
const WH = '44444444-4444-4444-4444-444444444401';
const CELL = '88888888-8888-8888-8888-888888888802';
const COUNTERPARTY = '66666666-6666-6666-6666-666666666601';

const html = async (url: string) => {
  const r = await app.request(url, { headers: { accept: 'text/html' } });
  return { status: r.status, body: await r.text() };
};

const json = async (url: string, init?: RequestInit) => {
  const r = await app.request(url, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const post = (url: string, body?: unknown) =>
  json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(async () => {
  await seedRefs();
  await seedExtra.clear();
});

describe('экран автопарка /fleet', () => {
  test('открывается и показывает все ТС', async () => {
    const { status, body } = await html('/fleet');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-fleet"');

    for (const code of ['АВТ-001', 'АВТ-002', 'АВТ-003', 'АВТ-004']) {
      expect(body, `ТС ${code} не показан`).toContain(code);
    }
  });

  test('состояние — словами, а не машинным кодом', async () => {
    const { body } = await html('/fleet');
    expect(body).toContain('В ремонте');
    expect(body).not.toContain('>in_repair<');
  });

  test('видно подразделение и госномер', async () => {
    const { body } = await html('/fleet');
    expect(body).toContain('Транспортный цех');
    expect(body).toContain('А123ВС777');
  });

  test('машина, которой пора на ТО, помечена причиной', async () => {
    const { body } = await html('/fleet');
    expect(body).toContain('data-testid="due-АВТ-003"');
    expect(body).toContain('по пробегу');
  });

  test('каждая строка ведёт в карточку', async () => {
    const { body } = await html('/fleet');
    expect(body).toContain(`href="/fleet/${CAR_DUE_KM}"`);
  });

  test('фильтр по состоянию работает в адресе', async () => {
    const all = await html('/fleet');
    const repair = await html('/fleet?status=in_repair');
    expect(repair.body).toContain('АВТ-003');
    expect(repair.body, 'фильтр не применился').not.toContain('АВТ-002');
    expect(all.body).toContain('АВТ-002');
  });

  test('есть ссылка на список ТО', async () => {
    const { body } = await html('/fleet');
    expect(body).toContain('href="/fleet/maintenance"');
  });
});

describe('список ТО /fleet/maintenance', () => {
  test('показывает три машины с причинами', async () => {
    const { status, body } = await html('/fleet/maintenance');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-maintenance"');

    // Причины на языке оператора.
    expect(body).toContain('по пробегу');
    expect(body).toContain('по сроку');
    expect(body).toContain('ТО не делали');
  });

  test('машина без необходимости ТО в список не попадает', async () => {
    const { body } = await html('/fleet/maintenance');
    expect(body).not.toContain('АВТ-002, ГАЗель');
  });
});

describe('карточка ТС /fleet/:id', () => {
  test('открывается и показывает пробег и срок ТО', async () => {
    const { status, body } = await html(`/fleet/${CAR_DUE_KM}`);
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-fleet-card"');
    expect(body).toContain('АВТ-003');
    expect(body).toContain('131');
  });

  test('история обслуживания показана словами при пустоте', async () => {
    const { body } = await html(`/fleet/${CAR_DUE_KM}`);
    expect(body).toContain('data-testid="card-work-orders"');
    expect(body).toContain('Нарядов по этой машине ещё не было');
  });

  test('есть форма отметки о выполненном ТО', async () => {
    const { body } = await html(`/fleet/${CAR_DUE_KM}`);
    expect(body).toContain('data-testid="service-done"');
    expect(body).toContain('hx-post="/ui/fleet/service"');
  });

  test('несуществующая машина → 404 со ссылкой назад', async () => {
    const { status, body } = await html('/fleet/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
    expect(body).toContain('href="/fleet"');
  });

  test('отметка о ТО через экран снимает машину со списка', async () => {
    const before = await html('/fleet/maintenance');
    expect(before.body).toContain('АВТ-003');

    const done = await app.request('/ui/fleet/service', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ carId: CAR_DUE_KM, view: 'fleet' }).toString(),
    });
    expect(done.status).toBe(200);

    const after = await html('/fleet/maintenance');
    expect(after.body, 'машина осталась в списке ТО').not.toContain('АВТ-003');
  });
});

describe('экран счетов /invoices', () => {
  test('пустой список объясняется словами', async () => {
    const { status, body } = await html('/invoices');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-invoices"');
    expect(body).toContain('data-testid="invoices-empty"');
  });

  test('счёт виден с состоянием и суммой', async () => {
    await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '7777.00', comment: 'Ремонт' });
    const { body } = await html('/invoices');

    expect(body).toContain('Черновик');
    expect(body).toContain('7777');
    expect(body).toContain('data-testid="invoice-action-');
  });

  test('кнопка отправки появляется только у черновика', async () => {
    const { body } = await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '100' });
    const id = String(body.id);
    await post(`/invoices/${id}/transition`, { to: 'sent' });

    const page = await html('/invoices');
    expect(page.body, 'кнопка отправки осталась у отправленного').not.toContain(`-${id}-sent"`);
    expect(page.body, 'нет кнопки оплаты').toContain(`-${id}-paid"`);
  });

  test('итог неоплаченных виден словами', async () => {
    await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '1234.00' });
    const { body } = await html('/invoices');
    expect(body).toContain('data-testid="invoices-unpaid"');
    expect(body).toContain('1234');
  });

  test('оплата через экран доводит счёт до «Оплачен»', async () => {
    const { body } = await post('/invoices', { counterpartyId: COUNTERPARTY, amount: '500' });
    const id = String(body.id);
    await post(`/invoices/${id}/transition`, { to: 'sent' });

    const paid = await app.request('/ui/invoices/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id, to: 'paid' }).toString(),
    });
    expect(paid.status).toBe(200);
    expect(await paid.text()).toContain('Оплачен');
  });
});

describe('экран склада /stock', () => {
  test('открывается и объясняет пустой склад', async () => {
    const { status, body } = await html('/stock');
    expect(status).toBe(200);
    expect(body).toContain('data-testid="page-stock"');
    expect(body).toContain('data-testid="stock-empty"');
  });

  test('остаток показан с местом хранения', async () => {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '7',
    });
    const { body } = await html('/stock');

    expect(body).toContain('data-testid="stock-row-');
    expect(body).toContain('A-01');
    expect(body).toContain('7');
  });

  test('резерв показан отдельно от свободного остатка', async () => {
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'receipt', quantity: '10',
    });
    await post('/stock/moves', {
      nomenclatureId: NOM, warehouseId: WH, cellId: CELL, kind: 'reserve', quantity: '4',
    });

    const { body } = await html('/stock');
    expect(body).toContain('data-testid="stock-reserved-');
    expect(body).toContain('4');
  });
});

describe('навигация', () => {
  test('в шапке есть все новые экраны', async () => {
    const { body } = await html('/lines');
    for (const id of ['nav-fleet', 'nav-invoices', 'nav-stock']) {
      expect(body, `нет ссылки ${id}`).toContain(`data-testid="${id}"`);
    }
  });

  test('ссылки ведут на существующие страницы', async () => {
    for (const url of ['/fleet', '/invoices', '/stock']) {
      const { status } = await html(url);
      expect(status, `${url} не открывается`).toBe(200);
    }
  });
});
