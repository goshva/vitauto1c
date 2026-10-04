'use strict';
// Хранилище сервиса — один JSON-файл: настройки прав, процессы, пользователи API, заказы, журнал.
// Запись атомарная (временный файл + переименование). Сервис однопроцессный, блокировки не нужны.
const fs = require('fs');
const path = require('path');
const { loadDefaultAccess, loadDefaultProcesses } = require('./sources');

const STORE_VERSION = 1;
const AUDIT_LIMIT = 2000;

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.state = null;
  }

  load() {
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.state.version !== STORE_VERSION) throw new Error(`Неизвестная версия хранилища ${this.state.version} в ${this.file}`);
    } else {
      this.state = Store.initialState();
      this.save();
    }
    return this.state;
  }

  static initialState() {
    return {
      version: STORE_VERSION,
      access: loadDefaultAccess(),
      processes: loadDefaultProcesses(),
      users: [],
      orders: [],
      audit: [],
      seq: { order: 0, line: 0, user: 0, audit: 0 }
    };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  nextId(kind, prefix) {
    this.state.seq[kind] = (this.state.seq[kind] || 0) + 1;
    return prefix + this.state.seq[kind];
  }

  audit(actor, action, target, details) {
    this.state.audit.push({
      id: this.nextId('audit', 'a'), at: new Date().toISOString(),
      user: actor ? actor.user : null, role: actor ? actor.role : null, action, target, details: details || null
    });
    if (this.state.audit.length > AUDIT_LIMIT) this.state.audit.splice(0, this.state.audit.length - AUDIT_LIMIT);
  }
}

module.exports = { Store };
