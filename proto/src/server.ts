import { OpenAPIHono } from '@hono/zod-openapi';
import { serveStatic } from 'hono/bun';
import { health } from './health.ts';
import { dashboardUi } from './dashboard-ui.ts';
import { lines } from './lines.ts';
import { fields } from './lines-fields.ts';
import { transitions } from './lines-transitions.ts';
import { imports } from './imports.ts';
import { operations } from './operations.ts';
import { supply } from './supply.ts';
import { print } from './print.ts';
import { printRepair } from './print-repair-routes.ts';
import { supplyUi } from './supply-ui.ts';
import { purchaseUi } from './purchase-ui.ts';
import { refs } from './refs.ts';
import { refCells } from './ref-cells.ts';
import { returns } from './returns.ts';
import { returnsFlow } from './returns-flow.ts';
import { shipments } from './shipments.ts';
import { shipmentsFlow } from './shipments-flow.ts';
import { workOrders } from './work-orders.ts';
import { workOrdersFlow } from './work-orders-flow.ts';
import { workOrdersStatus } from './work-orders-status.ts';
import { workOrdersParts } from './work-orders-parts.ts';
import { workOrdersCancel } from './work-orders-cancel.ts';
import { receipts } from './receipts.ts';
import { receiptsFlow } from './receipts-flow.ts';
import { stock } from './stock.ts';
import { zones } from './zones.ts';
import { unidentified } from './unidentified.ts';
import { processesUi } from './processes-ui.ts';
import { fleet } from './fleet.ts';
import { fleetUi, fleetPage, loadFleet, fleetCardPage, fleetMissingPage } from './fleet-ui.ts';
import { invoicesUi, invoicesPage } from './invoices-ui.ts';
import { stockUi } from './stock-ui.ts';
import { unidentifiedUi, unidentifiedPage } from './unidentified-ui.ts';
import { fleetCard } from './fleet-card.ts';
import { staff } from './staff.ts';
import { invoices } from './invoices.ts';
import { invoicesFlow } from './invoices-flow.ts';
import { supplierOrders } from './supplier-orders.ts';
import { purchase } from './purchase.ts';
import { supplierOrdersFlow } from './supplier-orders-flow.ts';
import { linesBulk } from './lines-bulk.ts';
import { linesLifecycle } from './lines-lifecycle.ts';
import { documentsUi } from './documents-ui.ts';
import { testHooks } from './test-hooks.ts';
import { orders } from './orders.ts';
import { ordersEdit } from './orders-edit.ts';
import { ordersRefusal } from './orders-refusal.ts';
import { linesPage, linesUi, wantsHtml } from './lines-ui.ts';
import { linesUiActions } from './lines-ui-actions.ts';
import { linesUiWarehouse } from './lines-ui-warehouse.ts';
import { Problem, problemResponse } from './problem.ts';
import { requestId } from './request-id.ts';
import { idempotency } from './idempotency.ts';
import type { AppEnv } from './env.ts';

// Сборка приложения. Всё явно: без init(), без глобальных переменных
// (prototype-spec.md §12: anti-patterns, которые убивают AI-разработку).
export const app = new OpenAPIHono<AppEnv>();

app.use('*', requestId);
app.use('*', idempotency);

// Статика: HTMX и таблица стилей лежат локально. Прототип обязан работать
// без сети — иначе «1С вне контура» превращается в «CDN вне контура».
//
// rewriteRequestPath обязателен: без него `/static/app.css` ищется как
// `public/static/app.css` и отдаётся 404 (проверено).
app.use(
  '/static/*',
  serveStatic({ root: './public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }),
);

// ОДИН обработчик ошибок: любой Problem превращается в problem+json с traceId.
app.onError((err, c) => {
  if (err instanceof Problem) return problemResponse(c, err);
  console.error(`[${c.get('requestId') ?? '-'}] ${err.message}`);
  return problemResponse(c, new Problem(500, 'internal', err.message));
});

// `GET /lines` — адрес экрана. Браузер просит HTML и получает страницу,
// тест и агент просят JSON и получают данные. Один URL, два представления.
// Регистрируется ДО JSON-маршрута: иначе JSON перехватил бы браузер.
app.get('/lines', async (c, next) => {
  if (!wantsHtml(c)) return next();
  const view = c.req.query('view');
  return c.html(await linesPage(view === 'purchases' ? 'purchase' : 'sale'));
});

// То же для новых экранов: `/fleet` и `/invoices` — адреса ЭКРАНОВ, а не только
// API. Браузер получает страницу, агент — данные. Без этого браузер видел бы JSON,
// а отдельный адрес для экрана разошёлся бы с API.
app.get('/fleet', async (c, next) => {
  if (!wantsHtml(c)) return next();
  const q = c.req.query();
  return c.html(fleetPage(await loadFleet(q), { status: q.status }));
});

app.get('/unidentified', async (c, next) => {
  if (!wantsHtml(c)) return next();
  return c.html(await unidentifiedPage());
});

app.get('/invoices', async (c, next) => {
  if (!wantsHtml(c)) return next();
  return c.html(await invoicesPage());
});

// Дашборд — домашний экран администратора: GET /. Монтируется ПЕРЕД остальными,
// иначе / перехватил бы кто-то другой.
app.route('/', dashboardUi);
app.route('/', health);
// linesBulk монтируется ДО lines: иначе /lines/{id} перехватил бы /lines/summary.
app.route('/', linesBulk);
app.route('/', linesLifecycle);
app.route('/', documentsUi);

// Тестовые хуки: только при PROTO_TEST_HOOKS=1. В обычном запуске адресов,
// меняющих данные в обход API, не должно быть.
if (Bun.env.PROTO_TEST_HOOKS === '1') app.route('/', testHooks);
app.route('/', lines);
app.route('/', fields);
app.route('/', transitions);
app.route('/', imports);
app.route('/', operations);
app.route('/', supply);
// Документные формы ремонта — ДО построчных: иначе /print/{kind} перехватил бы
// /print/work_order и ответил «формы нет».
app.route('/', printRepair);
app.route('/', print);
app.route('/', supplyUi);
app.route('/', purchaseUi);
app.route('/', refs);
app.route('/', refCells);
app.route('/', returns);
app.route('/', returnsFlow);
app.route('/', shipments);
app.route('/', shipmentsFlow);
app.route('/', workOrders);
app.route('/', workOrdersFlow);
app.route('/', workOrdersStatus);
app.route('/', workOrdersParts);
app.route('/', workOrdersCancel);
app.route('/', receipts);
app.route('/', receiptsFlow);
app.route('/', stock);
app.route('/', zones);
app.route('/', unidentified);
app.route('/', processesUi);
app.route('/', fleet);
app.route('/', fleetUi);

app.get('/fleet/:id', async (c, next) => {
  if (!wantsHtml(c)) return next();
  const id = c.req.param('id');
  const page = await fleetCardPage(id);
  return page ? c.html(page) : c.html(fleetMissingPage(id), 404);
});
app.route('/', invoicesUi);
app.route('/', stockUi);
app.route('/', unidentifiedUi);
app.route('/', fleetCard);
app.route('/', staff);
app.route('/', invoices);
app.route('/', invoicesFlow);
app.route('/', supplierOrders);
app.route('/', purchase);
app.route('/', supplierOrdersFlow);
app.route('/', orders);
app.route('/', ordersEdit);
app.route('/', ordersRefusal);
app.route('/', linesUi);
app.route('/', linesUiActions);
app.route('/', linesUiWarehouse);

export type App = typeof app;

// Сервер поднимается только при прямом запуске — в тестах app импортируется
// и вызывается через app.request(), без открытия порта.
if (import.meta.main) {
  const port = Number(Bun.env.PORT ?? 18190);
  console.log(`vitauto-proto слушает http://127.0.0.1:${port}`);
  Bun.serve({ port, hostname: '127.0.0.1', fetch: app.fetch });
}
