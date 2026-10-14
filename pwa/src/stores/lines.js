import { defineStore } from 'pinia';
import { api, get } from '../api';
import { load, save } from '../storage';

const DEFAULT_FILTERS = {
  periodFrom: '', periodTo: '', customerOrderId: '',
  hideShipped: false, hideDeleted: true, onlyWithPurchases: false, groupByCustomerOrder: true
};

export const useLinesStore = defineStore('lines', {
  state: () => ({
    view: 'sales',
    filters: { ...DEFAULT_FILTERS, ...load('filters', {}) },
    items: [],
    nextCursor: null,
    loading: false,
    totals: null,
    current: null // id выбранной строки (для команд по заказу)
  }),
  getters: {
    currentLine: s => s.items.find(l => l.id === s.current) || null,
    marked: s => s.items.filter(l => l.marked)
  },
  actions: {
    query(cursor) {
      const f = this.filters;
      return {
        view: this.view, periodFrom: f.periodFrom, periodTo: f.periodTo, customerOrderId: f.customerOrderId,
        hideShipped: f.hideShipped, hideDeleted: f.hideDeleted, onlyWithPurchases: f.onlyWithPurchases,
        groupByCustomerOrder: f.groupByCustomerOrder, limit: 100, cursor
      };
    },
    async load() {
      this.loading = true;
      save('filters', this.filters);
      try {
        const page = await get('/lines', this.query());
        this.items = page.items;
        this.nextCursor = page.nextCursor || null;
        await this.loadTotals();
      } finally {
        this.loading = false;
      }
    },
    async loadMore() {
      if (!this.nextCursor) return;
      this.loading = true;
      try {
        const page = await get('/lines', this.query(this.nextCursor));
        this.items.push(...page.items);
        this.nextCursor = page.nextCursor || null;
      } finally {
        this.loading = false;
      }
    },
    async loadTotals() {
      this.totals = await get('/selection', { view: this.view });
    },
    replace(line) {
      const i = this.items.findIndex(l => l.id === line.id);
      if (i >= 0) this.items.splice(i, 1, line);
      else this.items.push(line);
    },
    async refreshLine(id) {
      this.replace(await get('/lines/' + id));
    },
    async patch(line, field, value) {
      const { data } = await api('PATCH', '/lines/' + line.id, { body: { field, value } });
      this.replace(data);
      if (line.marked) await this.loadTotals();
      return data;
    },
    async toggleMark(line) {
      const { data } = await api('POST', `/lines/${line.id}/mark`);
      this.replace(data);
      await this.loadTotals();
    },
    async markOrder(customerOrderId, marked) {
      const { data } = await api('POST', '/selection', { body: { view: this.view, customerOrderId, marked } });
      await this.load();
      return data;
    },
    async remove(line) {
      await api('DELETE', '/lines/' + line.id);
      await this.load();
    },
    resetFilters() {
      this.filters = { ...DEFAULT_FILTERS };
    }
  }
});
