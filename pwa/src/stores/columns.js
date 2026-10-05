import { defineStore } from 'pinia';
import { load, save } from '../storage';
import presets from '../lib/process-presets.json';

// Видимость колонок таблицы строк: отдельно для каждой пары «роль + список» (sales / purchases / supply).
// Режимы: compact — основные; all — все; mine — редактируемые ролью; stage — колонки этапа процесса (process.html);
// custom — свой набор. «Скрывать пустые» убирает колонки без значений в загруженных строках.
export const COMPACT = ['order_client_number', 'customer', 'contract', 'name_fact', 'name', 'article', 'qty', 'stock_qty',
  'batch_fifo', 'price', 'sum', 'rrc', 'coefficient', 'extra_field_1', 'extra_field_2', 'supplier', 'shipment_date',
  'shipment_number', 'receipt_date', 'comment'];
// отметка и статус показываются отдельными колонками таблицы всегда
export const ALWAYS = ['cell_select', 'line_status'];
export const STAGES = presets.nodes;

const DEFAULT = { mode: 'compact', stage: null, ids: null, hideEmpty: false };

export const useColumnsStore = defineStore('columns', {
  state: () => ({ prefs: load('columns.v2', {}) }),
  actions: {
    pref(role, view) {
      return { ...DEFAULT, ...(this.prefs[`${role}.${view}`] || {}) };
    },
    set(role, view, patch) {
      this.prefs = { ...this.prefs, [`${role}.${view}`]: { ...this.pref(role, view), ...patch } };
      save('columns.v2', this.prefs);
    },
    reset(role, view) {
      const next = { ...this.prefs };
      delete next[`${role}.${view}`];
      this.prefs = next;
      save('columns.v2', this.prefs);
    },
    // id колонок, выбранных режимом (без учёта «скрывать пустые»)
    selectedIds(role, view, columns) {
      const p = this.pref(role, view);
      if (p.mode === 'all') return columns.map(c => c.id);
      if (p.mode === 'mine') return columns.filter(c => c.writable && c.rights.includes('+')).map(c => c.id);
      if (p.mode === 'stage') {
        const st = STAGES.find(s => s.id === p.stage);
        return st ? st.columns : COMPACT;
      }
      if (p.mode === 'custom' && Array.isArray(p.ids)) return p.ids;
      return COMPACT;
    },
    // колонки для таблицы: в порядке матрицы, без ALWAYS, с фильтром пустых
    visible(role, view, columns, items, isEmpty) {
      const p = this.pref(role, view);
      const ids = new Set(this.selectedIds(role, view, columns));
      return columns.filter(c => ids.has(c.id) && !ALWAYS.includes(c.id))
        .filter(c => !p.hideEmpty || !items.length || items.some(l => !isEmpty(l, c)));
    },
    toggle(role, view, columns, id) {
      const ids = new Set(this.selectedIds(role, view, columns));
      ids.has(id) ? ids.delete(id) : ids.add(id);
      this.set(role, view, { mode: 'custom', ids: [...ids] });
    }
  }
});
