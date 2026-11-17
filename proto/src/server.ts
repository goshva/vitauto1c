import { OpenAPIHono } from '@hono/zod-openapi';
import { serveStatic } from 'hono/bun';
import { fleetPage, loadFleet } from './fleet-ui.ts';
import { invoicesPage } from './invoices-ui.ts';
import { unidentifiedPage } from './unidentified-ui.ts';
import { linesPage, wantsHtml } from './lines-ui.ts';
import { filtersOf } from './lines-filters.ts';
import { roleOf } from './auth.ts';
import type { FilterValues } from './views/filters.ts';
import { startScheduler } from './scheduler.ts';
import { Problem, problemResponse } from './problem.ts';
import { requestId } from './request-id.ts';
import { idempotency } from './idempotency.ts';
import type { AppEnv } from './env.ts';
import { registerRoutes } from './routes.ts';

// Сборка приложения: middleware, обработчик ошибок, статика и экраны.
//
// СОСТАВ МАРШРУТОВ живёт в `routes.ts` — там перечень того, что смонтировано и в каком
// порядке. Здесь только СБОРКА: без init(), без глобальных переменных (prototype-spec.md §12).
export const app = new OpenAPIHono<AppEnv>();

app.use('*', requestId);
app.use('*', idempotency);

// Статика: HTMX и таблица стилей лежат локально. Прототип обязан работать без сети — иначе «1С вне контура» превращается в «CDN вне контура». rewriteRequestPath обязателен: без него `/static/app.css` ищется как `public/static/app.css` и отдаётся 404 (проверено).
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

// `GET /lines` — адрес ЭКРАНА: браузер получает HTML, агент — JSON. Регистрируется ДО
// JSON-маршрута: иначе JSON перехватил бы браузер.
app.get('/lines', async (c, next) => {
  if (!wantsHtml(c)) return next();
  const view = c.req.query('view');
  // Отбор передаётся и на СТРАНИЦУ: панель отбора живёт внутри области списка и
  // перерисовывается вместе с ней, поэтому её значения приходят с сервера, а не хранятся
  // в полях браузера. Ссылку с отбором можно переслать — она откроется тем же списком.
  return c.html(await linesPage(
    view === 'purchases' ? 'purchase' : 'sale',
    filtersOf(c.req.query()) as FilterValues,
    // Роль передаётся на страницу: по ней таблица решает, какие колонки показывать.
    // Без неё страница показала бы всё, а фрагмент после отметки — скрыл: таблица
    // менялась бы на глазах.
    roleOf(c),
  ));
});

// То же для `/fleet` и `/invoices`: адреса ЭКРАНОВ, а не только API.
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

// Дашборд — домашний экран администратора: GET /. Монтируется ПЕРЕД остальными, иначе / перехватил бы кто-то другой.
registerRoutes(app);

export type App = typeof app;

// Сервер поднимается только при прямом запуске — в тестах app импортируется и вызывается через app.request(), без открытия порта.
if (import.meta.main) {
  const port = Number(Bun.env.PORT ?? 18190);
  console.log(`vitauto-proto слушает http://127.0.0.1:${port}`);
  Bun.serve({ port, hostname: '127.0.0.1', fetch: app.fetch });
  // Планировщик — ВМЕСТЕ С ПРИЛОЖЕНИЕМ, а не отдельной службой: настройка внешнего планировщика в чужой системе — это то, что забывают при развёртывании.
  startScheduler();
}
