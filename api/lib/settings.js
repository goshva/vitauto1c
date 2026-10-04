'use strict';
// Запись настроек: матрица прав, процессы (узлы и сценарии), пользователи API. Меняет только администратор
// (проверка роли — в app.js). Каждое изменение проверяется на целостность и пишется в журнал.
const crypto = require('crypto');
const { normalizeCell, loadDefaultAccess, loadDefaultProcesses, LEVELS, EDIT_VALUES } = require('./sources');
const E = require('./errors');

const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

class Settings {
  constructor(store) { this.store = store; }
  get s() { return this.store.state; }

  ids(kind) { return this.s.access[kind].map(x => x.id); }

  // ---------------------------------------------------------------- права
  // Принимает формат сервиса {statusLevel, matrix} и экспорт index.html («Экспорт JSON»: settings.statusLevel, matrix).
  replaceAccess(actor, body) {
    if (!body || typeof body !== 'object' || !body.matrix) throw E.bad('Нужен объект с полем matrix (формат экспорта index.html)');
    const level = body.statusLevel || (body.settings && body.settings.statusLevel) || this.s.access.statusLevel;
    if (!LEVELS.includes(level)) throw E.bad(`statusLevel должен быть одним из: ${LEVELS.join(', ')}`);
    const roles = this.ids('roles'), statuses = this.ids('statuses'), columns = this.ids('columns');
    const problems = [];
    for (const lvl of Object.keys(body.matrix)) {
      if (!LEVELS.includes(lvl)) { problems.push(`неизвестный уровень «${lvl}»`); continue; }
      for (const role of Object.keys(body.matrix[lvl])) {
        if (!roles.includes(role)) { problems.push(`неизвестная роль «${role}»`); continue; }
        for (const st of Object.keys(body.matrix[lvl][role])) {
          if (!statuses.includes(st)) { problems.push(`неизвестный статус «${st}»`); continue; }
          for (const col of Object.keys(body.matrix[lvl][role][st])) {
            if (!columns.includes(col)) problems.push(`неизвестная колонка «${col}»`);
            else if (body.matrix[lvl][role][st][col].editable !== undefined && !EDIT_VALUES.includes(body.matrix[lvl][role][st][col].editable)) {
              problems.push(`${lvl}/${role}/${st}/${col}: editable должен быть одним из ${EDIT_VALUES.join(', ')}`);
            }
          }
        }
      }
    }
    if (problems.length) throw E.bad('Матрица не принята', { problems: [...new Set(problems)].slice(0, 50) });
    // Отсутствующие в файле ячейки остаются как были.
    let changed = 0;
    for (const lvl of LEVELS) for (const role of roles) for (const st of statuses) for (const col of columns) {
      const src = body.matrix[lvl] && body.matrix[lvl][role] && body.matrix[lvl][role][st] && body.matrix[lvl][role][st][col];
      if (!src) continue;
      const cell = normalizeCell(src, role, roles);
      if (JSON.stringify(cell) !== JSON.stringify(this.s.access.matrix[lvl][role][st][col])) changed++;
      this.s.access.matrix[lvl][role][st][col] = cell;
    }
    this.s.access.statusLevel = level;
    this.store.audit(actor, 'settings.access.replace', 'access', { changedCells: changed, statusLevel: level });
    this.store.save();
    return { changedCells: changed, statusLevel: level };
  }

  patchAccess(actor, body) {
    if (!body || typeof body !== 'object') throw E.bad('Нужен объект {statusLevel?, cells?}');
    const roles = this.ids('roles'), statuses = this.ids('statuses'), columns = this.ids('columns');
    const cells = body.cells || [];
    if (!Array.isArray(cells)) throw E.bad('cells должен быть массивом');
    if (body.statusLevel !== undefined && !LEVELS.includes(body.statusLevel)) throw E.bad(`statusLevel должен быть одним из: ${LEVELS.join(', ')}`);
    const problems = [];
    cells.forEach((c, i) => {
      const levels = c.level === '*' || c.level === undefined ? LEVELS : [c.level];
      if (!levels.every(l => LEVELS.includes(l))) problems.push(`#${i}: level — ${LEVELS.join(', ')} или *`);
      if (!roles.includes(c.role)) problems.push(`#${i}: неизвестная роль «${c.role}»`);
      if (!statuses.includes(c.status)) problems.push(`#${i}: неизвестный статус «${c.status}»`);
      if (!columns.includes(c.column)) problems.push(`#${i}: неизвестная колонка «${c.column}»`);
      if (c.editable !== undefined && !EDIT_VALUES.includes(c.editable)) problems.push(`#${i}: editable — ${EDIT_VALUES.join(', ')}`);
      if (c.editableRoles !== undefined && (!Array.isArray(c.editableRoles) || c.editableRoles.some(r => !roles.includes(r)))) problems.push(`#${i}: editableRoles — массив ролей из ${roles.join(', ')}`);
    });
    if (problems.length) throw E.bad('Изменения прав не приняты', { problems });
    const result = [];
    for (const c of cells) {
      for (const lvl of (c.level === '*' || c.level === undefined ? LEVELS : [c.level])) {
        const cur = this.s.access.matrix[lvl][c.role][c.status][c.column];
        const merged = {
          editable: c.editable !== undefined ? c.editable : cur.editable,
          editableRoles: c.editableRoles !== undefined ? c.editableRoles : cur.editableRoles,
          required: c.required !== undefined ? !!c.required : cur.required
        };
        const cell = normalizeCell(merged, c.role, roles);
        this.s.access.matrix[lvl][c.role][c.status][c.column] = cell;
        result.push({ level: lvl, role: c.role, status: c.status, column: c.column, cell });
      }
    }
    if (body.statusLevel !== undefined) this.s.access.statusLevel = body.statusLevel;
    this.store.audit(actor, 'settings.access.patch', 'access', { cells: result.length, statusLevel: body.statusLevel });
    this.store.save();
    return { statusLevel: this.s.access.statusLevel, cells: result };
  }

  // ---------------------------------------------------------------- процессы
  validateNode(id, n) {
    const problems = [];
    if (!ID_RE.test(id)) problems.push('id: латиница, цифры, _; начинается с буквы');
    if (!n || typeof n !== 'object') return ['тело — объект узла'];
    if (!this.ids('roles').includes(n.role)) problems.push(`role: одна из ${this.ids('roles').join(', ')}`);
    if (!n.title || typeof n.title !== 'string') problems.push('title: обязательная строка');
    for (const st of (n.statuses || [])) if (!this.ids('statuses').includes(st)) problems.push(`statuses: неизвестный статус «${st}»`);
    for (const col of (n.columns || [])) if (!this.ids('columns').includes(col)) problems.push(`columns: неизвестная колонка «${col}»`);
    const nodeIds = new Set(this.s.processes.nodes.map(x => x.id).concat(id));
    for (const nx of (n.next || [])) if (!nx || !nodeIds.has(nx.to)) problems.push(`next: неизвестный узел «${nx && nx.to}»`);
    return problems;
  }

  putNode(actor, id, body) {
    const problems = this.validateNode(id, body);
    if (problems.length) throw E.bad('Узел не принят', { problems });
    const node = {
      id, role: body.role, title: body.title, description: body.description || '',
      statuses: body.statuses || [], columns: body.columns || [],
      next: (body.next || []).map(x => ({ to: x.to, label: x.label || '' }))
    };
    const i = this.s.processes.nodes.findIndex(x => x.id === id);
    if (i >= 0) this.s.processes.nodes[i] = node; else this.s.processes.nodes.push(node);
    this.store.audit(actor, i >= 0 ? 'settings.node.update' : 'settings.node.create', id, null);
    this.store.save();
    return node;
  }

  deleteNode(actor, id) {
    const i = this.s.processes.nodes.findIndex(x => x.id === id);
    if (i < 0) throw E.notFound(`Узел «${id}» не найден`);
    const usedBy = this.s.processes.scenarios.filter(sc => sc.steps.some(st => st.nodes.includes(id))).map(sc => sc.id);
    if (usedBy.length) throw E.conflict('Узел используется в сценариях', { scenarios: usedBy });
    this.s.processes.nodes.splice(i, 1);
    for (const n of this.s.processes.nodes) n.next = n.next.filter(x => x.to !== id);
    this.store.audit(actor, 'settings.node.delete', id, null);
    this.store.save();
  }

  validateScenario(id, sc) {
    const problems = [];
    if (!ID_RE.test(id)) problems.push('id: латиница, цифры, _; начинается с буквы');
    if (!sc || typeof sc !== 'object') return ['тело — объект сценария'];
    if (!sc.title || typeof sc.title !== 'string') problems.push('title: обязательная строка');
    if (sc.group !== undefined && !this.s.processes.groups.some(g => g.id === sc.group)) problems.push(`group: одна из ${this.s.processes.groups.map(g => g.id).join(', ')}`);
    if (!Array.isArray(sc.steps) || !sc.steps.length) { problems.push('steps: непустой массив шагов'); return problems; }
    const nodeIds = new Set(this.s.processes.nodes.map(n => n.id));
    sc.steps.forEach((st, i) => {
      const nodes = st && (st.nodes || (st.node ? [st.node] : null));
      if (!Array.isArray(nodes) || !nodes.length) problems.push(`steps[${i}]: нужен nodes (массив узлов)`);
      else for (const nid of nodes) if (!nodeIds.has(nid)) problems.push(`steps[${i}]: неизвестный узел «${nid}»`);
      if (st && st.status !== null && st.status !== undefined && !this.ids('statuses').includes(st.status)) problems.push(`steps[${i}]: неизвестный статус «${st.status}»`);
    });
    if (sc.steps[0] && !sc.steps[0].status) problems.push('steps[0]: у первого шага должен быть статус');
    return problems;
  }

  putScenario(actor, id, body) {
    const problems = this.validateScenario(id, body);
    if (problems.length) throw E.bad('Сценарий не принят', { problems });
    const sc = {
      id, group: body.group || null, title: body.title,
      steps: body.steps.map(st => ({ nodes: st.nodes || [st.node], status: st.status || null, note: st.note || '' }))
    };
    const i = this.s.processes.scenarios.findIndex(x => x.id === id);
    if (i >= 0) {
      // Шаги, на которых стоят заказы, должны остаться — иначе заказ потеряет текущий шаг.
      const stuck = this.s.orders.filter(o => o.scenarioId === id && o.stepIndex >= sc.steps.length).map(o => o.id);
      if (stuck.length) throw E.conflict('В новом сценарии меньше шагов, чем пройдено незавершёнными заказами', { orders: stuck });
      this.s.processes.scenarios[i] = sc;
    } else this.s.processes.scenarios.push(sc);
    this.store.audit(actor, i >= 0 ? 'settings.scenario.update' : 'settings.scenario.create', id, { steps: sc.steps.length });
    this.store.save();
    return sc;
  }

  deleteScenario(actor, id) {
    const i = this.s.processes.scenarios.findIndex(x => x.id === id);
    if (i < 0) throw E.notFound(`Сценарий «${id}» не найден`);
    const orders = this.s.orders.filter(o => o.scenarioId === id).map(o => o.id);
    if (orders.length) throw E.conflict('По сценарию есть заказы', { orders });
    this.s.processes.scenarios.splice(i, 1);
    this.store.audit(actor, 'settings.scenario.delete', id, null);
    this.store.save();
  }

  reset(actor, body) {
    const what = (body && body.what) || 'all';
    if (!['access', 'processes', 'all'].includes(what)) throw E.bad('what: access, processes или all');
    if (what !== 'access') {
      const fresh = loadDefaultProcesses();
      const missing = [...new Set(this.s.orders.map(o => o.scenarioId))].filter(id => !fresh.scenarios.some(s => s.id === id));
      if (missing.length) throw E.conflict('После сброса пропадут сценарии, по которым есть заказы', { scenarios: missing });
      this.s.processes = fresh;
    }
    if (what !== 'processes') this.s.access = loadDefaultAccess();
    this.store.audit(actor, 'settings.reset', what, null);
    this.store.save();
    return { reset: what };
  }

  // ---------------------------------------------------------------- пользователи API
  static hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

  findByToken(token) { return this.s.users.find(u => u.tokenHash === Settings.hash(token)) || null; }

  createUser(actor, body, opts = {}) {
    if (!body || !body.name || typeof body.name !== 'string') throw E.bad('name: обязательная строка');
    if (!this.ids('roles').includes(body.role)) throw E.bad(`role: одна из ${this.ids('roles').join(', ')}`);
    if (this.s.users.some(u => u.name === body.name)) throw E.conflict(`Пользователь «${body.name}» уже есть`);
    const token = opts.token || crypto.randomBytes(24).toString('hex');
    const user = { id: this.store.nextId('user', 'u'), name: body.name, role: body.role, tokenHash: Settings.hash(token), createdAt: new Date().toISOString() };
    this.s.users.push(user);
    this.store.audit(actor, 'settings.user.create', user.id, { name: user.name, role: user.role });
    this.store.save();
    return { user: Settings.publicUser(user), token };
  }

  updateUser(actor, id, body) {
    const u = this.s.users.find(x => x.id === id);
    if (!u) throw E.notFound(`Пользователь «${id}» не найден`);
    if (body.role !== undefined && !this.ids('roles').includes(body.role)) throw E.bad(`role: одна из ${this.ids('roles').join(', ')}`);
    if (u.role === 'admin' && body.role && body.role !== 'admin' && this.s.users.filter(x => x.role === 'admin').length === 1) {
      throw E.conflict('Нельзя снять роль с последнего администратора');
    }
    let token = null;
    if (body.role) u.role = body.role;
    if (body.rotateToken) { token = crypto.randomBytes(24).toString('hex'); u.tokenHash = Settings.hash(token); }
    this.store.audit(actor, 'settings.user.update', id, { role: body.role, rotateToken: !!body.rotateToken });
    this.store.save();
    return token ? { user: Settings.publicUser(u), token } : { user: Settings.publicUser(u) };
  }

  deleteUser(actor, id) {
    const i = this.s.users.findIndex(x => x.id === id);
    if (i < 0) throw E.notFound(`Пользователь «${id}» не найден`);
    if (this.s.users[i].role === 'admin' && this.s.users.filter(x => x.role === 'admin').length === 1) throw E.conflict('Нельзя удалить последнего администратора');
    this.s.users.splice(i, 1);
    this.store.audit(actor, 'settings.user.delete', id, null);
    this.store.save();
  }

  static publicUser(u) { return { id: u.id, name: u.name, role: u.role, createdAt: u.createdAt }; }
}

module.exports = { Settings };
