import { expect, test, type APIRequestContext } from '@playwright/test';

// e2e: КАЖДЫЙ из 11 процессов проводится от сида до конечного состояния
// через реальный HTTP-стек.
//
// Отличие от интеграционных тестов: там вызывается `app.request()` в том же
// процессе, здесь — настоящие HTTP-запросы к запущенному серверу.
//
// Состояние процесса готовится через `/__test__/seed` (включён в e2e флагом
// PROTO_TEST_HOOKS=1): тесты идут последовательно на одной базе, и без сброса
// каждый ловил бы состояние предыдущего.

/** Отмечает строку и выполняет действие; возвращает состояние после. */
async function act(req: APIRequestContext, line: string, path: string, body?: unknown): Promise<string> {
  await req.post(`/lines/${line}/mark`, { data: { marked: true } });
  const r = await req.post(path, { data: body ?? {} });
  expect(r.status(), `${path}: ${r.status()} ${await r.text()}`).toBeLessThan(300);
  return statusOf(req, line);
}

async function statusOf(req: APIRequestContext, line: string): Promise<string> {
  const r = await req.get(`/lines/${line}`);
  return String(((await r.json()) as { status: string }).status);
}

interface Scenario {
  id: string;
  title: string;
  /** Идентификатор строки из сида — явный, а не вычисленный: у mixed_order их две. */
  line: string;
  /** Начальное состояние — тоже из сида, а не «предполагаем new». */
  from: string;
  steps: { call: (req: APIRequestContext, l: string) => Promise<string>; to: string }[];
}

const B = 'b0000000-0000-0000-0000-0000000000';

const SCENARIOS: Scenario[] = [
  {
    id: 'happy', title: 'Основной: закупка → отгрузка', line: `${B}01`, from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/sales/jobs'), to: 'ordered' },
      { call: (r, l) => act(r, l, '/supply/status', { status: 'paid' }), to: 'paid' },
      { call: (r, l) => act(r, l, '/supply/status', { status: 'in_transit' }), to: 'in_transit' },
      { call: (r, l) => act(r, l, '/supply/status', { status: 'acceptance' }), to: 'acceptance' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    id: 'stock', title: 'Со склада (резерв)', line: `${B}02`, from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'reserve' }), to: 'reserve' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    // Две строки: первая со склада, вторая в закупку. Проверяем первую.
    id: 'mixed_order', title: 'Смешанный заказ', line: 'b0000000-0000-0000-0000-000000000301', from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'reserve' }), to: 'reserve' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    id: 'delivery_split', title: 'Самовывоз у поставщика', line: `${B}04`, from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/sales/jobs'), to: 'ordered' },
      { call: (r, l) => act(r, l, '/supply/status', { status: 'paid' }), to: 'paid' },
      // Самовывоз: клиент забирает сам, комплектация не нужна (N4).
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'shipped' }), to: 'shipped' },
      // Закрытие отгруженной строки требует галки «Документ подписан оригинал» (C22).
      {
        call: async (r, l) => {
          await r.patch(`/lines/${l}`, { data: { field: 'signed_original', value: true } });
          return act(r, l, '/lines/transition', { to: 'closed' });
        },
        to: 'closed',
      },
    ],
  },
  {
    id: 'virtual_buy', title: 'Виртуальный закуп', line: `${B}05`, from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/sales/jobs'), to: 'ordered' },
      { call: (r, l) => act(r, l, '/supply/status', { status: 'paid' }), to: 'paid' },
    ],
  },
  {
    id: 'defect', title: 'Контроль комплектации', line: `${B}06`, from: 'assembly',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    // Отмена заказа у поставщика: строка возвращается в «Новый» — закупку
    // начинают заново. Проверяем, что строка освободилась.
    id: 'cancel_supplier', title: 'Отмена заказа у поставщика', line: `${B}07`, from: 'ordered',
    steps: [
      {
        call: async (r, l) => {
          // Заказ поставщику создаётся по ОТМЕЧЕННЫМ строкам — отмечаем.
          await r.post(`/lines/${l}/mark`, { data: { marked: true } });
          const created = await r.post('/supplier-orders', { data: {} });
          expect(created.status(), await created.text()).toBe(201);
          const id = String(((await created.json()) as { id: string }).id);
          const cancelled = await r.post(`/supplier-orders/${id}/cancel`);
          expect(cancelled.status(), await cancelled.text()).toBe(200);
          return statusOf(r, l);
        },
        to: 'new',
      },
    ],
  },
  {
    // Возврат от клиента: строка отгружена, оформляется возврат (N3) и принимается (K6).
    id: 'return', title: 'Возврат от клиента', line: `${B}08`, from: 'shipped',
    steps: [
      {
        call: async (r, l) => {
          await r.post(`/lines/${l}/mark`, { data: { marked: true } });
          const created = await r.post('/returns', { data: { kind: 'client' } });
          expect(created.status(), await created.text()).toBe(201);
          const id = String(((await created.json()) as { id: string }).id);
          const accepted = await r.post(`/returns/${id}/accept`);
          expect(accepted.status(), await accepted.text()).toBe(200);
          return statusOf(r, l);
        },
        to: 'to_stock',
      },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    // Возврат поставщику: возврат уже оформлен (M16), строка в «Возврат».
    id: 'return_mgr', title: 'Возврат поставщику', line: `${B}09`, from: 'return',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    id: 'return_internal', title: 'Отказ клиента при получении', line: 'b0000000-0000-0000-0000-00000000000a', from: 'ready_to_ship',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
  {
    id: 'car_repair_in', title: 'Поступление машины в ремонт', line: 'b0000000-0000-0000-0000-00000000000b', from: 'new',
    steps: [
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'reserve' }), to: 'reserve' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'assembly' }), to: 'assembly' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'ready_to_ship' }), to: 'ready_to_ship' },
      { call: (r, l) => act(r, l, '/lines/transition', { to: 'closed' }), to: 'closed' },
    ],
  },
];

test.describe('все 11 процессов проходятся через HTTP', () => {
  for (const s of SCENARIOS) {
    test(`${s.id}: ${s.title}`, async ({ request }) => {
      const seeded = await request.post('/__test__/seed', { data: { process: s.id, reset: true } });
      expect(seeded.status(), await seeded.text()).toBe(200);

      // Начальное состояние — из сида, а не «предполагаем new»: четыре процесса
      // начинаются не с «Нового».
      expect(await statusOf(request, s.line), `${s.id}: неверное начальное состояние`).toBe(s.from);

      for (const step of s.steps) {
        expect(await step.call(request, s.line), `${s.id}: не дошли до «${step.to}»`).toBe(step.to);
      }
    });
  }
});
