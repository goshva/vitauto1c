import { defineStore } from 'pinia';
import { load, save } from '../storage';

// Настройки интерфейса на устройстве: тема, раскладка списка строк (карточки / таблица), плотность.
// layout 'auto' — карточки на телефоне, таблица на широком экране.
export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: load('ui.theme', 'system'),      // system | light | dark
    layout: load('ui.layout', 'auto'),      // auto | cards | table
    density: load('ui.density', 'comfortable'), // comfortable | compact
    wide: typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : true
  }),
  getters: {
    effectiveLayout: s => (s.layout === 'auto' ? (s.wide ? 'table' : 'cards') : s.layout)
  },
  actions: {
    init() {
      this.applyTheme();
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(min-width: 900px)');
        const on = () => { this.wide = mq.matches; };
        mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
      }
    },
    setTheme(t) { this.theme = t; save('ui.theme', t === 'system' ? null : t); this.applyTheme(); },
    setLayout(l) { this.layout = l; save('ui.layout', l === 'auto' ? null : l); },
    setDensity(d) { this.density = d; save('ui.density', d === 'comfortable' ? null : d); },
    applyTheme() {
      if (typeof document === 'undefined') return;
      const el = document.documentElement;
      if (this.theme === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', this.theme);
      const meta = document.querySelector('meta[name=theme-color]');
      const dark = this.theme === 'dark' || (this.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (meta) meta.setAttribute('content', dark ? '#131a24' : '#ffffff');
    }
  }
});
