'use strict';
// HTTP-слой: маршруты /api/v1/*, аутентификация по токену, JSON, ошибки, OpenAPI и Swagger UI.
const http = require('http');
const { Store } = require('./store');
const { Engine } = require('./engine');
const { Settings } = require('./settings');
const { buildOpenApi } = require('./openapi');
const E = require('./errors');

const BASE = '/api/v1';
const BODY_LIMIT = 5 * 1024 * 1024;   // экспорт матрицы из index.html — около 1,5 МБ

function createApp({ dataDir, adminToken, log = console.log } = {}) {
  const store = new Store(dataDir);
  store.load();
  const engine = new Engine(store);
  const settings = new Settings(store);

  // Первый запуск: создать администратора API. Токен — из параметра/переменной окружения или случайный.
  if (!store.state.users.length) {
    const { token } = settings.createUser(null, { name: 'admin', role: 'admin' }, { token: adminToken });
    log(adminToken ? 'Создан администратор API «admin» с токеном из VITAUTO_ADMIN_TOKEN.'
                   : `Создан администратор API «admin». Токен (показывается один раз): ${token}`);
  }

  const S = () => store.state;
  const meta = () => ({
    statusLevel: S().access.statusLevel, levels: ['order', 'line'],
    roles: S().access.roles, statuses: S().access.statuses, columns: S().access.columns
  });

  // auth: none — без токена; any — любой пользователь API; admin — только роль admin
  const routes = [
    ['GET', '/health', 'none', () => ({ ok: true })],
    ['GET', '/meta', 'any', () => meta()],
    ['GET', '/me', 'any', (req) => req.actor],
    ['GET', '/processes', 'any', () => S().processes],
    ['GET', '/processes/{scenarioId}', 'any', (req) => engine.scenario(req.params.scenarioId)],
    ['GET', '/orders', 'any', (req) => engine.listOrders(req.query)],
    ['POST', '/orders', 'any', (req) => [201, engine.createOrder(req.actor, req.body)]],
    ['GET', '/orders/{orderId}', 'any', (req) => engine.order(req.params.orderId)],
    ['GET', '/orders/{orderId}/actions', 'any', (req) => engine.actions(req.actor, req.params.orderId)],
    ['POST', '/orders/{orderId}/advance', 'any', (req) => engine.advance(req.actor, req.params.orderId, req.body)],
    ['POST', '/orders/{orderId}/goto', 'admin', (req) => engine.goto(req.actor, req.params.orderId, req.body)],
    ['POST', '/orders/{orderId}/lines', 'any', (req) => [201, engine.addLine(req.actor, req.params.orderId, req.body)]],
    ['PATCH', '/orders/{orderId}/lines/{lineId}', 'any', (req) => engine.updateLine(req.actor, req.params.orderId, req.params.lineId, req.body)],
    ['GET', '/orders/{orderId}/lines/{lineId}/permissions', 'any', (req) => engine.permissions(req.actor, req.params.orderId, req.params.lineId)],
    ['GET', '/settings/access', 'any', () => S().access],
    ['PUT', '/settings/access', 'admin', (req) => settings.replaceAccess(req.actor, req.body)],
    ['PATCH', '/settings/access', 'admin', (req) => settings.patchAccess(req.actor, req.body)],
    ['PUT', '/settings/processes/nodes/{nodeId}', 'admin', (req) => settings.putNode(req.actor, req.params.nodeId, req.body)],
    ['DELETE', '/settings/processes/nodes/{nodeId}', 'admin', (req) => { settings.deleteNode(req.actor, req.params.nodeId); return [204]; }],
    ['PUT', '/settings/processes/scenarios/{scenarioId}', 'admin', (req) => settings.putScenario(req.actor, req.params.scenarioId, req.body)],
    ['DELETE', '/settings/processes/scenarios/{scenarioId}', 'admin', (req) => { settings.deleteScenario(req.actor, req.params.scenarioId); return [204]; }],
    ['POST', '/settings/reset', 'admin', (req) => settings.reset(req.actor, req.body)],
    ['GET', '/settings/users', 'admin', () => S().users.map(Settings.publicUser)],
    ['POST', '/settings/users', 'admin', (req) => [201, settings.createUser(req.actor, req.body)]],
    ['PATCH', '/settings/users/{userId}', 'admin', (req) => settings.updateUser(req.actor, req.params.userId, req.body || {})],
    ['DELETE', '/settings/users/{userId}', 'admin', (req) => { settings.deleteUser(req.actor, req.params.userId); return [204]; }],
    ['GET', '/audit', 'admin', (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 2000);
      return S().audit.slice(-limit).reverse();
    }]
  ].map(([method, path, auth, handler]) => ({
    method, path, auth, handler,
    re: new RegExp('^' + path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '$')
  }));

  const openapi = buildOpenApi(routes);

  function authenticate(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) throw E.unauthorized('Нужен заголовок Authorization: Bearer <токен>');
    const u = settings.findByToken(m[1].trim());
    if (!u) throw E.unauthorized('Неизвестный токен');
    return { id: u.id, user: u.name, role: u.role };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > BODY_LIMIT) { reject(E.bad('Тело запроса больше 5 МБ')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve(undefined);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(E.bad('Тело запроса — не JSON: ' + e.message)); }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body, type = 'application/json; charset=utf-8') {
    if (status === 204) { res.writeHead(204); res.end(); return; }
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/docs')) return send(res, 200, swaggerPage(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openapi);
      if (!url.pathname.startsWith(BASE + '/')) throw E.notFound('Нет такого адреса. Документация: /docs');
      const path = url.pathname.slice(BASE.length);
      const candidates = routes.filter(r => r.re.test(path));
      if (!candidates.length) throw E.notFound('Нет такого адреса. Документация: /docs');
      const route = candidates.find(r => r.method === req.method);
      if (!route) { res.setHeader('Allow', candidates.map(r => r.method).join(', ')); throw new E.ApiError(405, 'method_not_allowed', 'Метод не поддерживается'); }
      const ctx = { params: route.re.exec(path).groups || {}, query: Object.fromEntries(url.searchParams), headers: req.headers };
      for (const k of Object.keys(ctx.params)) ctx.params[k] = decodeURIComponent(ctx.params[k]);
      if (route.auth !== 'none') {
        ctx.actor = authenticate(req);
        if (route.auth === 'admin' && ctx.actor.role !== 'admin') throw E.forbidden('Действие доступно только роли admin');
      }
      ctx.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
      const out = await route.handler(ctx);
      if (Array.isArray(out) && typeof out[0] === 'number') return send(res, out[0], out[1]);
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof E.ApiError) return send(res, e.status, { error: e.code, message: e.message, details: e.details });
      log('Ошибка обработки ' + req.method + ' ' + req.url + ': ' + (e && e.stack || e));
      return send(res, 500, { error: 'internal', message: 'Внутренняя ошибка сервиса' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, store, engine, settings, routes, openapi };
}

function swaggerPage() {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Витавто API — процессы и права</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
<style>body{margin:0;background:#fff}</style></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui', persistAuthorization: true });</script>
</body></html>`;
}

module.exports = { createApp, BASE };
