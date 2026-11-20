import { OpenAPIHono } from '@hono/zod-openapi';
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
import { loginUi } from './login-ui.ts';
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
import { workOrdersHistory } from './work-orders-history.ts';
import { receipts } from './receipts.ts';
import { receiptsFlow } from './receipts-flow.ts';
import { stock } from './stock.ts';
import { zones } from './zones.ts';
import { unidentified } from './unidentified.ts';
import { processesUi } from './processes-ui.ts';
import { fleet } from './fleet.ts';
import { fleetUi, fleetCardPage, fleetMissingPage } from './fleet-ui.ts';
import { invoicesUi } from './invoices-ui.ts';
import { stockUi } from './stock-ui.ts';
import { unidentifiedUi } from './unidentified-ui.ts';
import { fleetCard } from './fleet-card.ts';
import { staff } from './staff.ts';
import { invoices } from './invoices.ts';
import { invoicesFlow } from './invoices-flow.ts';
import { supplierOrders } from './supplier-orders.ts';
import { purchase } from './purchase.ts';
import { supplyOptions } from './supply-options.ts';
import { supplierOrdersFlow } from './supplier-orders-flow.ts';
import { linesBulk } from './lines-bulk.ts';
import { linesLifecycle } from './lines-lifecycle.ts';
import { documentsUi } from './documents-ui.ts';
import { orders } from './orders.ts';
import { ordersEdit } from './orders-edit.ts';
import { ordersRefusal } from './orders-refusal.ts';
import { testHooks } from './test-hooks.ts';
import { linesUi, wantsHtml } from './lines-ui.ts';
import { linesUiActions } from './lines-ui-actions.ts';
import { importPaste } from './import-paste.ts';
import { returnsFind } from './returns-find.ts';
import { auditApi } from './audit-api.ts';
import { auditUi } from './audit-ui.ts';
import { jobsUi } from './jobs-ui.ts';
import { matchingRoutes } from './matching-routes.ts';
import { reports } from './reports.ts';
import { reportsUi } from './reports-ui.ts';
import { lineSteps } from './lines-steps.ts';
import { lineProcess } from './lines-process.ts';
import { linesUiWarehouse } from './lines-ui-warehouse.ts';
import type { AppEnv } from './env.ts';

// СОСТАВ МАРШРУТОВ: что смонтировано и В КАКОМ ПОРЯДКЕ.
//
// Вынесено из `server.ts` по размеру, но разделение вышло по смыслу: там СБОРКА приложения
// (middleware, обработчик ошибок, статика), здесь ПЕРЕЧЕНЬ маршрутов.
//
// ПОРЯДОК ЗДЕСЬ — ЧАСТЬ ПОВЕДЕНИЯ, а не оформление, и комментарии его объясняют: где
// монтируется раньше, чтобы широкий шаблон не перехватил узкий. Поэтому регистрация
// остаётся одним списком, а не разносится по файлам.

export function registerRoutes(app: OpenAPIHono<AppEnv>): void {
  app.route('/', dashboardUi);
  app.route('/', health);
  // linesBulk монтируется ДО lines: иначе /lines/{id} перехватил бы /lines/summary.
  app.route('/', linesBulk);
  app.route('/', linesLifecycle);
  app.route('/', documentsUi);
  app.route('/', auditUi);
  app.route('/', returnsFind);
  // Тестовые хуки: только при PROTO_TEST_HOOKS=1. В обычном запуске адресов, меняющих
  // данные в обход API, не должно быть.
  //
  // ПРИ ВЫНОСЕ МАРШРУТОВ ЭТА СТРОКА ПОТЕРЯЛАСЬ — вместе с ней пропал и сид для проверок, а
  // тесты процессов получили 404. Мой отбор оставлял строки `app.route(` и комментарии, но
  // импорт `testHooks` был признан неиспользуемым и убран РАНЬШЕ, чем я добавил саму строку.
  app.route('/', testHooks);
  app.route('/', lines);
  app.route('/', auditApi);
  app.route('/', fields);
  app.route('/', transitions);
  app.route('/', imports);
  app.route('/', operations);
  app.route('/', supply);
  // Документные формы ремонта — ДО построчных: иначе /print/{kind} перехватил бы /print/work_order и ответил «формы нет».
  app.route('/', printRepair);
  app.route('/', print);
  app.route('/', supplyUi);
  // Вход и выход — рядом с экранами, до API: `/login` не должен попасть под согласование формата, иначе агент получил бы HTML вместо отказа.
  app.route('/', loginUi);
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
  // История наряда — рядом с нарядом: она читается карточкой, а не общим журналом.
  app.route('/', workOrdersHistory);
  app.route('/', receipts);
  app.route('/', receiptsFlow);
  app.route('/', stock);
  app.route('/', zones);
  app.route('/', unidentified);
  app.route('/', processesUi);
  app.route('/', fleet);
  app.route('/', fleetUi);

  // КАРТОЧКА ТС — ОТДЕЛЬНЫМ ОБРАБОТЧИКОМ, И ЭТО НЕ ОФОРМЛЕНИЕ.
  //
  // Здесь стоял `app.get('/fleet/:id', …)`, и при выносе маршрутов мой отбор строк его
  // ПОТЕРЯЛ: я оставлял только строки, начинающиеся с `app.route(`, а этот обработчик
  // многострочный. Карточка стала отдавать JSON вместо страницы — и это заметили тесты.
  //
  // Стоит он ИМЕННО ЗДЕСЬ, между `fleetUi` и `fleetCard`: `/fleet/:id` должен успеть
  // отдать страницу раньше, чем совпадёт широкий маршрут API.
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
  app.route('/', supplyOptions);
  app.route('/', supplierOrdersFlow);
  app.route('/', orders);
  app.route('/', ordersEdit);
  app.route('/', ordersRefusal);
  app.route('/', linesUi);
  app.route('/', linesUiActions);
  app.route('/', importPaste);
  app.route('/', linesUiWarehouse);
  app.route('/', jobsUi);
  app.route('/', matchingRoutes);
  app.route('/', reports);
  app.route('/', reportsUi);
  app.route('/', lineSteps);
  // Назначение процесса — рядом с шагами: без процесса строка по шагам не двигается.
  app.route('/', lineProcess);
}
