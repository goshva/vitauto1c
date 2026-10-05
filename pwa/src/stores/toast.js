import { defineStore } from 'pinia';

export const useToastStore = defineStore('toast', {
  state: () => ({ items: [], seq: 0 }),
  actions: {
    show(text, kind = 'info', ms = 4500) {
      const id = ++this.seq;
      this.items.push({ id, text, kind });
      setTimeout(() => this.dismiss(id), ms);
    },
    error(e) {
      const text = e && e.code ? `${e.status || ''} ${e.code}: ${e.message}${e.field ? ` (${e.field})` : ''}` : String(e && e.message || e);
      this.show(text, 'error', 8000);
    },
    dismiss(id) {
      this.items = this.items.filter(t => t.id !== id);
    }
  }
});
