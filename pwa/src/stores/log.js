import { defineStore } from 'pinia';

// Журнал запросов к API — для отладки: метод, URL, код, время, тела запроса и ответа.
export const useLogStore = defineStore('log', {
  state: () => ({ entries: [], seq: 0 }),
  getters: {
    errors: s => s.entries.filter(e => e.status === 0 || e.status >= 400).length
  },
  actions: {
    add(entry) {
      this.entries.unshift({ id: ++this.seq, ...entry });
      if (this.entries.length > 300) this.entries.length = 300;
    },
    clear() {
      this.entries = [];
    }
  }
});
