'use strict';
// Тесты API на реальных значениях по умолчанию: роли, статусы и права — из index.html и default-matrix.js,
// сценарии — из process.html. Сервис поднимается на свободном порту с временным хранилищем.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app');

const ADMIN = 'test-admin-token';
let dataDir, app, base;
const tok = {};          // роль -> токен
const users = {};        // роль -> {id, name}

async function call(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const api = (method, p, token, body) => call(method, '/api/v1' + p, token, body);

async function start(dir) {
  const a = createApp({ dataDir: dir, adminToken: ADMIN, log: () => {} });
  await new Promise(r => a.server.listen(0, '127.0.0.1', r));
  return a;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitauto-api-'));
  app = await start(dataDir);
  base = 'http://127.0.0.1:' + app.server.address().port;
  tok.admin = ADMIN;
  for (const role of ['manager', 'storekeeper', 'chief_mechanic', 'supplier', 'client']) {
    const r = await api('POST', '/settings/users', ADMIN, { name: 'test-' + role, role });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    tok[role] = r.body.token;
    users[role] = r.body.user;
  }
});

after(() => {
  app.server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('доступ и документация', () => {
  it('health без токена, остальное — только с токеном', async () => {
    assert.equal((await api('GET', '/health')).status, 200);
    assert.equal((await api('GET', '/meta')).status, 401);
    assert.equal((await api('GET', '/meta', 'wrong-token')).status, 401);
    const me = await api('GET', '/me', tok.manager);
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'manager');
  });

  it('OpenAPI описывает все маршруты, Swagger UI открывается', async () => {
    const spec = await call('GET', '/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.body.openapi, '3.0.3');
    for (const r of app.routes) {
      const op = spec.body.paths[r.path] && spec.body.paths[r.path][r.method.toLowerCase()];
      assert.ok(op, `нет ${r.method} ${r.path} в спецификации`);
      assert.ok(Object.keys(op.responses).length, `нет ответов у ${r.method} ${r.path}`);
      if (r.auth === 'admin') assert.ok(op.responses['403'], `нет 403 у ${r.method} ${r.path}`);
    }
    const refs = JSON.stringify(spec.body).match(/#\/components\/schemas\/\w+/g) || [];
    for (const ref of new Set(refs)) assert.ok(spec.body.components.schemas[ref.split('/').pop()], 'нет схемы ' + ref);
    const docs = await call('GET', '/docs');
    assert.equal(docs.status, 200);
    assert.match(docs.body, /swagger-ui/);
  });

  it('метаданные — из прототипов', async () => {
    const m = await api('GET', '/meta', tok.client);
    assert.deepEqual(m.body.roles.map(r => r.id), ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client']);
    assert.equal(m.body.statuses.length, 15);
    assert.equal(m.body.columns.length, 50);
    assert.equal(m.body.columns.find(c => c.id === 'gosnomer_fact').code, 'Е4');
    assert.equal(m.body.columns.find(c => c.id === 'qty').code, 'Н0');
    const p = await api('GET', '/processes/happy', tok.client);
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.steps[0].nodes, ['N1']);
  });

  it('неизвестный адрес — 404, неверный метод — 405', async () => {
    assert.equal((await api('GET', '/nope', tok.admin)).status, 404);
    assert.equal((await api('DELETE', '/meta', tok.admin)).status, 405);
  });
});

describe('процесс «happy» с правами по матрице', () => {
  let order, lineId;

  it('начать сценарий может только роль первого шага (клиент) или admin', async () => {
    const r = await api('POST', '/orders', tok.manager, { scenarioId: 'happy' });
    assert.equal(r.status, 403);
    assert.equal((await api('POST', '/orders', tok.client, { scenarioId: 'нет_такого' })).status, 404);
  });

  it('клиент не может заполнить колонку, которую матрица ему не даёт', async () => {
    const r = await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { name_fact: 'Фонарь' } }] });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.details.denied.map(d => d.column), ['name_fact']);
    assert.equal((await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { несуществующая: 1 } }] })).status, 400);
  });

  it('клиент создаёт заказ с разрешённой колонкой', async () => {
    const r = await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { comment: 'Заявка по фото' } }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    order = r.body;
    lineId = order.lines[0].id;
    assert.equal(order.status, 'new');
    assert.equal(order.stepIndex, 0);
    assert.equal(order.lines[0].createdBy, 'test-client');
  });

  it('следующий шаг (M1) выполняет менеджер, а не клиент', async () => {
    assert.equal((await api('POST', `/orders/${order.id}/advance`, tok.client)).status, 403);
    const act = await api('GET', `/orders/${order.id}/actions`, tok.manager);
    assert.equal(act.body.canAdvance, true);
    assert.deepEqual(act.body.nextStep.roles, ['manager']);
    const r = await api('POST', `/orders/${order.id}/advance`, tok.manager, { comment: 'загружено в 1С' });
    assert.equal(r.status, 200);
    assert.equal(r.body.stepIndex, 1);
    assert.equal(r.body.history.at(-1).comment, 'загружено в 1С');
  });

  it('менеджер правит разрешённые колонки, запрещённая блокирует весь запрос', async () => {
    const bad = await api('PATCH', `/orders/${order.id}/lines/${lineId}`, tok.manager, { values: { name_fact: 'Фонарь задний', sum: 100 } });
    assert.equal(bad.status, 403);
    assert.deepEqual(bad.body.details.denied.map(d => d.column), ['sum']);
    const o = await api('GET', `/orders/${order.id}`, tok.manager);
    assert.equal(o.body.lines[0].values.name_fact, undefined, 'при запрете не должно меняться ничего');
    const good = await api('PATCH', `/orders/${order.id}/lines/${lineId}`, tok.manager, { values: { name_fact: 'Фонарь задний', qty_fact: '1' } });
    assert.equal(good.status, 200);
    assert.equal(good.body.values.name_fact, 'Фонарь задний');
  });

  it('внутри статуса «Новый» шаги идут без проверки обязательных колонок', async () => {
    const r = await api('POST', `/orders/${order.id}/advance`, tok.manager);
    assert.equal(r.status, 200);
    assert.equal(r.body.stepIndex, 2);
    assert.equal(r.body.status, 'new');
  });

  it('уйти из «Новый» нельзя, пока не заполнены обязательные колонки', async () => {
    const act = await api('GET', `/orders/${order.id}/actions`, tok.manager);
    assert.equal(act.body.canAdvance, false);
    const r = await api('POST', `/orders/${order.id}/advance`, tok.manager);
    assert.equal(r.status, 422);
    const cols = r.body.details.missing.map(m => m.column);
    for (const c of ['order_date', 'order_client_number', 'qty']) assert.ok(cols.includes(c), 'ожидалась обязательная ' + c);
  });

  it('force доступен только admin', async () => {
    assert.equal((await api('POST', `/orders/${order.id}/advance`, tok.manager, { force: true })).status, 403);
  });

  it('после заполнения обязательных — переход в «Заказано у поставщика»', async () => {
    const act = await api('GET', `/orders/${order.id}/actions`, tok.manager);
    const values = {};
    for (const m of act.body.missingRequired) values[m.column] = m.column === 'qty' ? '1' : 'заполнено';
    const fill = await api('PATCH', `/orders/${order.id}/lines/${lineId}`, tok.manager, { values });
    assert.equal(fill.status, 200, JSON.stringify(fill.body));
    const r = await api('POST', `/orders/${order.id}/advance`, tok.manager);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'ordered');
    assert.equal(r.body.lines[0].status, 'ordered');
  });

  it('шаг P1 выполняет поставщик', async () => {
    assert.equal((await api('POST', `/orders/${order.id}/advance`, tok.manager)).status, 403);
    const r = await api('POST', `/orders/${order.id}/advance`, tok.supplier);
    assert.equal(r.status, 200);
    assert.equal(r.body.stepIndex, 4);
  });

  it('права на колонки строки для роли в текущем статусе', async () => {
    const p = await api('GET', `/orders/${order.id}/lines/${lineId}/permissions`, tok.client);
    assert.equal(p.status, 200);
    assert.equal(p.body.status, 'ordered');
    const by = Object.fromEntries(p.body.columns.map(c => [c.column, c]));
    assert.equal(by.comment.editable, true);
    assert.equal(by.name.editable, false);
    assert.equal(by.gosnomer_fact.code, 'Е4');
  });

  it('goto — только admin; admin force пропускает обязательные и пишется в историю', async () => {
    assert.equal((await api('POST', `/orders/${order.id}/goto`, tok.manager, { stepIndex: 0 })).status, 403);
    assert.equal((await api('POST', `/orders/${order.id}/goto`, tok.admin, { stepIndex: 99 })).status, 400);
    const g = await api('POST', `/orders/${order.id}/goto`, tok.admin, { stepIndex: 2, comment: 'вернуть' });
    assert.equal(g.status, 200);
    assert.equal(g.body.stepIndex, 2);
    await api('PATCH', `/orders/${order.id}/lines/${lineId}`, tok.manager, { values: { qty: '' } });
    const f = await api('POST', `/orders/${order.id}/advance`, tok.admin, { force: true });
    assert.equal(f.status, 200);
    assert.equal(f.body.history.at(-1).action, 'advance.force');
    assert.ok(f.body.history.at(-1).skippedRequired.some(m => m.column === 'qty'));
  });

  it('отбор заказов по статусу и сценарию', async () => {
    const r = await api('GET', '/orders?status=ordered&scenarioId=happy', tok.storekeeper);
    assert.equal(r.status, 200);
    assert.ok(r.body.some(o => o.id === order.id));
    assert.equal((await api('GET', '/orders?status=closed', tok.storekeeper)).body.length, 0);
  });
});

describe('запись настроек прав', () => {
  it('менять права может только admin', async () => {
    const r = await api('PATCH', '/settings/access', tok.manager, { cells: [] });
    assert.equal(r.status, 403);
    assert.equal((await api('GET', '/settings/access', tok.manager)).status, 200, 'читать матрицу может любая роль');
  });

  it('ошибочные ячейки отклоняются целиком', async () => {
    const r = await api('PATCH', '/settings/access', tok.admin, { cells: [
      { role: 'client', status: 'new', column: 'name_fact', editable: 'role', editableRoles: ['client'] },
      { role: 'client', status: 'new', column: 'нет_колонки', editable: 'role' }
    ] });
    assert.equal(r.status, 400);
    const a = await api('GET', '/settings/access', tok.admin);
    assert.ok(!a.body.matrix.order.client.new.name_fact.editableRoles.includes('client'));
  });

  it('выданное право сразу действует в процессе', async () => {
    const p = await api('PATCH', '/settings/access', tok.admin, { cells: [
      { role: 'client', status: 'new', column: 'name_fact', editable: 'role', editableRoles: ['client', 'manager'] }
    ] });
    assert.equal(p.status, 200);
    assert.equal(p.body.cells.length, 2, 'level * — обе ячейки: order и line');
    const r = await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { name_fact: 'Шкив ГАЗ' } }] });
    assert.equal(r.status, 201);
  });

  it('правило creator: менять может только автор строки', async () => {
    const o = await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { comment: 'от клиента' } }] });
    const line = o.body.lines[0].id;
    await api('PATCH', '/settings/access', tok.admin, { cells: [
      { role: 'client', status: 'new', column: 'comment', editable: 'creator' },
      { role: 'manager', status: 'new', column: 'comment', editable: 'creator' }
    ] });
    assert.equal((await api('PATCH', `/orders/${o.body.id}/lines/${line}`, tok.manager, { values: { comment: 'менеджер' } })).status, 403);
    assert.equal((await api('PATCH', `/orders/${o.body.id}/lines/${line}`, tok.client, { values: { comment: 'клиент' } })).status, 200);
  });

  it('правило admin: менять может только администратор', async () => {
    const o = await api('POST', '/orders', tok.client, { scenarioId: 'happy', lines: [{ values: { comment: 'x' } }] });
    const line = o.body.lines[0].id;
    await api('PATCH', '/settings/access', tok.admin, { cells: [
      { role: 'manager', status: 'new', column: 'service_type', editable: 'admin' },
      { role: 'admin', status: 'new', column: 'service_type', editable: 'admin' }
    ] });
    const m = await api('PATCH', `/orders/${o.body.id}/lines/${line}`, tok.manager, { values: { service_type: 'Ремонт' } });
    assert.equal(m.status, 403);
    assert.equal(m.body.details.denied[0].rule, 'admin');
    assert.equal((await api('PATCH', `/orders/${o.body.id}/lines/${line}`, tok.admin, { values: { service_type: 'Ремонт' } })).status, 200);
  });

  it('загрузка экспорта index.html (column-matrix (5).json)', async () => {
    const file = path.join(__dirname, '..', '..', 'column-matrix (5).json');
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = await api('PUT', '/settings/access', tok.admin, exported);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.statusLevel, exported.settings.statusLevel);
    assert.ok(r.body.changedCells > 0);
    const bad = await api('PUT', '/settings/access', tok.admin, { matrix: { order: { robot: {} } } });
    assert.equal(bad.status, 400);
  });

  it('уровень статуса и сброс к прототипу', async () => {
    const l = await api('PATCH', '/settings/access', tok.admin, { statusLevel: 'line' });
    assert.equal(l.body.statusLevel, 'line');
    assert.equal((await api('PATCH', '/settings/access', tok.admin, { statusLevel: 'quarter' })).status, 400);
    const r = await api('POST', '/settings/reset', tok.admin, { what: 'access' });
    assert.equal(r.status, 200);
    const a = await api('GET', '/settings/access', tok.admin);
    assert.equal(a.body.statusLevel, 'order');
    assert.ok(!a.body.matrix.order.client.new.name_fact.editableRoles.includes('client'));
  });
});

describe('запись настроек процессов', () => {
  it('менять процессы может только admin', async () => {
    const r = await api('PUT', '/settings/processes/scenarios/quick', tok.manager, { title: 'x', steps: [{ nodes: ['M1'], status: 'new' }] });
    assert.equal(r.status, 403);
  });

  it('сценарий с неизвестным узлом или статусом не принимается', async () => {
    const r = await api('PUT', '/settings/processes/scenarios/quick', tok.admin, { title: 'Быстрый', steps: [{ nodes: ['ZZ'], status: 'new' }, { nodes: ['M4'], status: 'космос' }] });
    assert.equal(r.status, 400);
    assert.equal(r.body.details.problems.length, 2);
  });

  it('новый сценарий и узел работают в процессе', async () => {
    const n = await api('PUT', '/settings/processes/nodes/X1', tok.admin, { role: 'storekeeper', title: 'Проверка на складе', statuses: ['in_work'], next: [{ to: 'M4' }] });
    assert.equal(n.status, 200, JSON.stringify(n.body));
    const s = await api('PUT', '/settings/processes/scenarios/quick', tok.admin, { group: 'main', title: 'Быстрый', steps: [
      { nodes: ['M1'], status: 'new' }, { nodes: ['X1'], status: 'in_work' }, { nodes: ['M4'], status: 'ordered' }
    ] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal((await api('POST', '/orders', tok.client, { scenarioId: 'quick' })).status, 403);
    const o = await api('POST', '/orders', tok.manager, { scenarioId: 'quick' });
    assert.equal(o.status, 201);
    assert.equal((await api('POST', `/orders/${o.body.id}/advance`, tok.manager)).status, 403, 'шаг X1 — кладовщика');
    const k = await api('POST', `/orders/${o.body.id}/advance`, tok.storekeeper);
    assert.equal(k.status, 200);
    assert.equal(k.body.status, 'in_work');
  });

  it('нельзя удалить узел из сценария и сценарий с заказами', async () => {
    assert.equal((await api('DELETE', '/settings/processes/nodes/X1', tok.admin)).status, 409);
    assert.equal((await api('DELETE', '/settings/processes/scenarios/quick', tok.admin)).status, 409);
    const tmp = await api('PUT', '/settings/processes/scenarios/tmp', tok.admin, { title: 'Временный', steps: [{ nodes: ['M1'], status: 'new' }] });
    assert.equal(tmp.status, 200);
    assert.equal((await api('DELETE', '/settings/processes/scenarios/tmp', tok.admin)).status, 204);
    assert.equal((await api('GET', '/processes/tmp', tok.admin)).status, 404);
  });

  it('узел с неизвестной ролью не принимается', async () => {
    const r = await api('PUT', '/settings/processes/nodes/X2', tok.admin, { role: 'robot', title: 'Робот' });
    assert.equal(r.status, 400);
  });
});

describe('пользователи API, журнал, хранение', () => {
  it('новый токен заменяет старый, повтор имени — конфликт', async () => {
    assert.equal((await api('POST', '/settings/users', tok.admin, { name: 'test-manager', role: 'manager' })).status, 409);
    const r = await api('PATCH', `/settings/users/${users.storekeeper.id}`, tok.admin, { rotateToken: true });
    assert.equal(r.status, 200);
    assert.equal((await api('GET', '/me', tok.storekeeper)).status, 401);
    tok.storekeeper = r.body.token;
    assert.equal((await api('GET', '/me', tok.storekeeper)).status, 200);
  });

  it('последнего администратора нельзя удалить или понизить', async () => {
    const list = await api('GET', '/settings/users', tok.admin);
    const admin = list.body.find(u => u.role === 'admin');
    assert.equal((await api('DELETE', `/settings/users/${admin.id}`, tok.admin)).status, 409);
    assert.equal((await api('PATCH', `/settings/users/${admin.id}`, tok.admin, { role: 'manager' })).status, 409);
    assert.ok(!JSON.stringify(list.body).includes('tokenHash'), 'хэш токена не отдаётся');
  });

  it('журнал видит только admin', async () => {
    assert.equal((await api('GET', '/audit', tok.manager)).status, 403);
    const a = await api('GET', '/audit?limit=500', tok.admin);
    assert.equal(a.status, 200);
    const actions = new Set(a.body.map(x => x.action));
    for (const x of ['order.create', 'order.advance', 'line.update', 'settings.access.patch', 'settings.scenario.create', 'settings.user.create']) {
      assert.ok(actions.has(x), 'в журнале нет ' + x);
    }
  });

  it('данные переживают перезапуск сервиса', async () => {
    const before = (await api('GET', '/orders', tok.admin)).body.length;
    app.server.close();
    app = await start(dataDir);
    base = 'http://127.0.0.1:' + app.server.address().port;
    assert.equal((await api('GET', '/orders', tok.admin)).body.length, before);
    assert.equal((await api('GET', '/me', tok.manager)).body.role, 'manager');
    assert.equal((await api('GET', '/processes/quick', tok.manager)).status, 200);
  });
});
