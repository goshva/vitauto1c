import { defineStore } from 'pinia';
import { load, save } from '../storage';
import presets from '../lib/process-presets.json';

// Отображаемые поля списка строк — отдельно для каждой пары «роль + список» (sales / purchases / supply):
//   таблица (ПК)  — режим колонок: compact — основные; all — все; mine — редактируемые ролью; stage — колонки этапа
//                   процесса (process.html); custom — свой набор; hideEmpty убирает колонки без значений;
//   карточка      — cardIds: поля под заголовком карточки, в выбранном порядке (null — набор по умолчанию списка);
//   детали строки — detailHideEmpty (пустые поля свёрнуты), detailEditableFirst (сначала то, что можно менять).
export const COMPACT = ['order_client_number', 'customer', 'contract', 'name_fact', 'name', 'article', 'qty', 'stock_qty',
  'batch_fifo', 'price', 'sum', 'rrc', 'coefficient', 'extra_field_1', 'extra_field_2', 'supplier', 'shipment_date',
  'shipment_number', 'receipt_date', 'comment'];
// отметка и статус показываются всегда (отдельно)
export const ALWAYS = ['cell_select', 'line_status'];
// заголовок карточки: наименование (ФАКТ / номенклатура) и артикул — всегда
export const CARD_TITLE = ['name_fact', 'name', 'article_fact', 'article'];
export const CARD_DEFAULT = {
  sales: ['qty', 'extra_field_1', 'extra_field_2', 'supplier', 'shipment_date', 'comment'],
  purchases: ['qty', 'price', 'sum', 'supplier', 'receipt_date', 'comment'],
  supply: ['qty', 'price', 'supplier', 'paid_status', 'delivery_term', 'comment']
};
export const CARD_MAX = 12;
export const STAGES = presets.nodes;

const DEFAULT = { mode: 'compact', stage: null, ids: null, hideEmpty: false, cardIds: null, detailHideEmpty: true, detailEditableFirst: true };

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
    // ---------- таблица
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
    },
    // ---------- карточка (телефон)
    cardIds(role, view) {
      const p = this.pref(role, view);
      return Array.isArray(p.cardIds) ? p.cardIds : (CARD_DEFAULT[view] || CARD_DEFAULT.sales);
    },
    // поля карточки в выбранном порядке (только существующие в матрице роли)
    cardColumns(role, view, columns) {
      const by = Object.fromEntries(columns.map(c => [c.id, c]));
      return this.cardIds(role, view).map(id => by[id]).filter(Boolean);
    },
    setCard(role, view, ids) {
      this.set(role, view, { cardIds: ids.slice(0, CARD_MAX) });
    },
    toggleCard(role, view, id) {
      const ids = [...this.cardIds(role, view)];
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1); else if (ids.length < CARD_MAX) ids.push(id);
      this.setCard(role, view, ids);
    },
    moveCard(role, view, id, delta) {
      const ids = [...this.cardIds(role, view)];
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      this.setCard(role, view, ids);
    }
  }
});
