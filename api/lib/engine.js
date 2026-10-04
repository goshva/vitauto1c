'use strict';
// Движок процессов: заказ идёт по шагам сценария из process.html.
//   - Создать заказ может роль первого шага сценария или администратор.
//   - Перейти на следующий шаг может роль узла этого шага (у шага бывает несколько узлов) или администратор.
//   - Уйти со статуса нельзя, пока не заполнены колонки, обязательные в нём (required в матрице) для ролей,
//     которые по сценарию работают в этом статусе. Переход между шагами внутри статуса не проверяется:
//     обязательную колонку часто заполняет следующий шаг (клиент передал заявку — дату заказа ставит менеджер).
//     Администратор может перейти принудительно (force), это пишется в журнал.
//   - Шаг со статусом null статус не меняет.
//   - Значения колонок строки меняются только с правом по матрице (см. access.js), запрос либо проходит целиком, либо нет.
const { checkEdit, requiredColumns, isEmptyValue, statusFor } = require('./access');
const E = require('./errors');

class Engine {
  constructor(store) { this.store = store; }
  get s() { return this.store.state; }

  scenario(id) {
    const sc = this.s.processes.scenarios.find(x => x.id === id);
    if (!sc) throw E.notFound(`Сценарий «${id}» не найден`);
    return sc;
  }

  nodeRoles(step) {
    const roles = new Set();
    for (const nid of step.nodes) {
      const node = this.s.processes.nodes.find(n => n.id === nid);
      if (node) roles.add(node.role);
    }
    return [...roles];
  }

  order(id) {
    const o = this.s.orders.find(x => x.id === id);
    if (!o) throw E.notFound(`Заказ «${id}» не найден`);
    return o;
  }

  line(order, lineId) {
    const l = order.lines.find(x => x.id === lineId);
    if (!l) throw E.notFound(`Строка «${lineId}» не найдена в заказе ${order.id}`);
    return l;
  }

  knownColumn(col) { return this.s.access.columns.some(c => c.id === col); }

  // Проверить и применить значения; при любом запрете не меняется ничего.
  assertCanWrite(actor, order, line, values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw E.bad('values должен быть объектом {колонка: значение}');
    const unknown = Object.keys(values).filter(c => !this.knownColumn(c));
    if (unknown.length) throw E.bad('Неизвестные колонки', { columns: unknown });
    const denied = [];
    for (const col of Object.keys(values)) {
      const r = checkEdit(this.s.access, actor, order, line, col);
      if (!r.ok) denied.push({ column: col, rule: r.rule, reason: r.reason });
    }
    if (denied.length) throw E.forbidden('Нет права менять колонки', { status: statusFor(this.s.access, order, line), denied });
  }

  createOrder(actor, body) {
    const sc = this.scenario(body && body.scenarioId);
    const first = sc.steps[0];
    const roles = this.nodeRoles(first);
    if (actor.role !== 'admin' && !roles.includes(actor.role)) {
      throw E.forbidden(`Начать сценарий «${sc.id}» может роль первого шага: ${roles.join(', ')}`);
    }
    const now = new Date().toISOString();
    const order = {
      id: this.store.nextId('order', 'o'), scenarioId: sc.id, stepIndex: 0, status: first.status || 'new',
      createdBy: actor.user, createdRole: actor.role, createdAt: now, updatedAt: now, lines: [], history: []
    };
    order.history.push({ at: now, user: actor.user, role: actor.role, action: 'create', step: 0, nodes: first.nodes, status: order.status });
    for (const l of (body.lines || [])) this.addLineInternal(actor, order, l);
    this.s.orders.push(order);
    this.store.audit(actor, 'order.create', order.id, { scenarioId: sc.id });
    this.store.save();
    return order;
  }

  addLineInternal(actor, order, body) {
    const values = (body && body.values) || {};
    const line = { id: this.store.nextId('line', 'l'), status: order.status, createdBy: actor.user, values: {} };
    this.assertCanWrite(actor, order, line, values);
    Object.assign(line.values, values);
    order.lines.push(line);
    return line;
  }

  addLine(actor, orderId, body) {
    const order = this.order(orderId);
    const step = this.currentStep(order);
    const roles = this.nodeRoles(step);
    if (actor.role !== 'admin' && !roles.includes(actor.role)) {
      throw E.forbidden(`Добавлять строки на шаге «${step.nodes.join('+')}» может роль: ${roles.join(', ')}`);
    }
    const line = this.addLineInternal(actor, order, body);
    order.updatedAt = new Date().toISOString();
    this.store.audit(actor, 'line.add', `${order.id}/${line.id}`, { columns: Object.keys(line.values) });
    this.store.save();
    return line;
  }

  updateLine(actor, orderId, lineId, body) {
    const order = this.order(orderId);
    const line = this.line(order, lineId);
    const values = body && body.values;
    this.assertCanWrite(actor, order, line, values);
    const changes = {};
    for (const [col, v] of Object.entries(values)) { changes[col] = { from: line.values[col] === undefined ? null : line.values[col], to: v }; line.values[col] = v; }
    order.updatedAt = new Date().toISOString();
    this.store.audit(actor, 'line.update', `${order.id}/${line.id}`, changes);
    this.store.save();
    return line;
  }

  permissions(actor, orderId, lineId) {
    const order = this.order(orderId);
    const line = this.line(order, lineId);
    const status = statusFor(this.s.access, order, line);
    const required = new Set(requiredColumns(this.s.access, [actor.role], status));
    return {
      role: actor.role, status, statusLevel: this.s.access.statusLevel,
      columns: this.s.access.columns.map(c => {
        const r = checkEdit(this.s.access, actor, order, line, c.id);
        return { column: c.id, code: c.code, editable: r.ok, rule: r.rule, required: required.has(c.id) };
      })
    };
  }

  currentStep(order) { return this.scenario(order.scenarioId).steps[order.stepIndex]; }

  // Роли, которые по сценарию работают в статусе status (узлы всех шагов с этим статусом).
  statusRoles(sc, status) {
    const roles = new Set();
    for (const st of sc.steps) if (st.status === status) for (const r of this.nodeRoles(st)) roles.add(r);
    return [...roles];
  }

  // Незаполненные колонки, обязательные в текущем статусе заказа (для ролей этого статуса в сценарии).
  missingRequired(order) {
    const sc = this.scenario(order.scenarioId);
    const missing = [];
    for (const line of order.lines) {
      const status = statusFor(this.s.access, order, line);
      for (const col of requiredColumns(this.s.access, this.statusRoles(sc, status), status)) {
        if (isEmptyValue(line.values[col])) missing.push({ line: line.id, column: col });
      }
    }
    return missing;
  }

  leavesStatus(order, step) { return !!step.status && step.status !== order.status; }

  actions(actor, orderId) {
    const order = this.order(orderId);
    const sc = this.scenario(order.scenarioId);
    const cur = sc.steps[order.stepIndex];
    const next = sc.steps[order.stepIndex + 1] || null;
    const curRoles = this.nodeRoles(cur);

    const out = {
      orderId: order.id, scenarioId: sc.id, status: order.status,
      currentStep: { index: order.stepIndex, nodes: cur.nodes, roles: curRoles, note: cur.note },
      nextStep: next ? { index: order.stepIndex + 1, nodes: next.nodes, roles: this.nodeRoles(next), status: next.status || order.status, note: next.note } : null,
      missingRequired: next && this.leavesStatus(order, next) ? this.missingRequired(order) : []
    };
    out.canAdvance = !!next && (actor.role === 'admin' || out.nextStep.roles.includes(actor.role)) && !out.missingRequired.length;
    if (!next) out.reason = 'сценарий завершён';
    else if (actor.role !== 'admin' && !out.nextStep.roles.includes(actor.role)) out.reason = `следующий шаг выполняет роль: ${out.nextStep.roles.join(', ')}`;
    else if (out.missingRequired.length) out.reason = `не заполнены колонки, обязательные в статусе «${order.status}»`;
    return out;
  }

  advance(actor, orderId, body) {
    const order = this.order(orderId);
    const sc = this.scenario(order.scenarioId);
    const next = sc.steps[order.stepIndex + 1];
    if (!next) throw E.conflict('Сценарий завершён — следующего шага нет');
    const roles = this.nodeRoles(next);
    if (actor.role !== 'admin' && !roles.includes(actor.role)) {
      throw E.forbidden(`Шаг «${next.nodes.join('+')}» выполняет роль: ${roles.join(', ')}`);
    }
    const force = !!(body && body.force);
    if (force && actor.role !== 'admin') throw E.forbidden('Принудительный переход (force) доступен только администратору');
    const missing = this.leavesStatus(order, next) ? this.missingRequired(order) : [];
    if (missing.length && !force) throw E.unprocessable(`Не заполнены колонки, обязательные в статусе «${order.status}»`, { status: order.status, missing });
    return this.moveTo(actor, order, order.stepIndex + 1, { action: force && missing.length ? 'advance.force' : 'advance', comment: body && body.comment, missing });
  }

  goto(actor, orderId, body) {
    if (actor.role !== 'admin') throw E.forbidden('Переход на произвольный шаг доступен только администратору');
    const order = this.order(orderId);
    const sc = this.scenario(order.scenarioId);
    const idx = body && body.stepIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= sc.steps.length) throw E.bad(`stepIndex должен быть от 0 до ${sc.steps.length - 1}`);
    return this.moveTo(actor, order, idx, { action: 'goto', comment: body.comment });
  }

  moveTo(actor, order, idx, info) {
    const step = this.scenario(order.scenarioId).steps[idx];
    const from = { step: order.stepIndex, status: order.status };
    order.stepIndex = idx;
    if (step.status) {
      order.status = step.status;
      for (const line of order.lines) line.status = step.status;
    }
    order.updatedAt = new Date().toISOString();
    const entry = { at: order.updatedAt, user: actor.user, role: actor.role, action: info.action, step: idx, nodes: step.nodes, status: order.status, from };
    if (info.comment) entry.comment = String(info.comment);
    if (info.missing && info.missing.length) entry.skippedRequired = info.missing;
    order.history.push(entry);
    this.store.audit(actor, 'order.' + info.action, order.id, { from, to: { step: idx, status: order.status } });
    this.store.save();
    return order;
  }

  listOrders(query) {
    return this.s.orders.filter(o =>
      (!query.status || o.status === query.status) && (!query.scenarioId || o.scenarioId === query.scenarioId)
    );
  }
}

module.exports = { Engine };
