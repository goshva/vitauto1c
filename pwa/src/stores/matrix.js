import { defineStore } from 'pinia';
import { api } from '../api';
import { load, save } from '../storage';

// Матрица прав роли: GET /matrix с ETag. Маска rights — символ на статус из statuses:
// '+' можно, 'c' только автору строки (markedBy), '.' нельзя.
export const useMatrixStore = defineStore('matrix', {
  state: () => ({ role: null, statuses: [], columns: [], etag: null, loadedAt: null }),
  getters: {
    byField: s => Object.fromEntries(s.columns.map(c => [c.field, c]))
  },
  actions: {
    async load(role) {
      const cached = load('matrix.' + role, null);
      const headers = cached && cached.etag ? { 'If-None-Match': cached.etag } : {};
      const res = await api('GET', '/matrix', { headers });
      const data = res.status === 304 && cached ? cached : { ...res.data, etag: res.headers.get('ETag') };
      this.role = data.role;
      this.statuses = data.statuses;
      this.columns = data.columns;
      this.etag = data.etag;
      this.loadedAt = new Date();
      if (res.status !== 304) save('matrix.' + role, data);
    },
    // Почему ячейку нельзя менять — или null, если можно.
    denyReason(column, line, userName) {
      if (!column.writable) return 'поле только для чтения';
      if (line.locked || line.status === 'locked_background') return 'строка заблокирована фоном';
      const i = this.statuses.indexOf(line.status);
      const ch = i < 0 ? '.' : column.rights[i];
      if (ch === '+') return null;
      if (ch === 'c') return line.markedBy === userName ? null : 'меняет только автор строки';
      return `матрица: нельзя в статусе «${line.status}»`;
    }
  }
});
