import { defineStore } from 'pinia';
import { api } from '../api';
import { load, save, loadSession, saveSession } from '../storage';

// стандартный интерфейс OData публикации 1С (vite проксирует /odata -> <публикация>/odata/standard.odata)
export const DEFAULT_BASE = '/odata';

// До v2.22 токен (в нём пароль) лежал в localStorage бессрочно — стираем его при запуске.
save('token', null);
save('user', null);

export const useSessionStore = defineStore('session', {
  state: () => ({
    baseUrl: load('baseUrl', DEFAULT_BASE),
    token: loadSession('token', null),
    user: loadSession('user', null), // { userName, login, role, screen, userRef } — userRef: элемент справочника «Пользователи»
    expired: false
  }),
  getters: {
    loggedIn: s => !!s.token,
    role: s => (s.user && s.user.role) || null,
    isSupply: s => !!s.user && s.user.role === 'supply',
    isAdmin: s => !!s.user && s.user.role === 'admin',
    // какие списки доступны роли: supply — только канбан снабжения
    views: s => (s.user && s.user.role === 'supply' ? ['supply'] : s.user && s.user.role === 'admin' ? ['sales', 'purchases', 'supply'] : ['sales', 'purchases'])
  },
  actions: {
    setBaseUrl(url) {
      this.baseUrl = url || DEFAULT_BASE;
      save('baseUrl', this.baseUrl === DEFAULT_BASE ? null : this.baseUrl);
    },
    async login(login, password) {
      const { data } = await api('POST', '/session', { body: { login, password } });
      this.token = data.token;
      this.user = { userName: data.userName, login: data.login, role: data.role, screen: data.screen, userRef: data.userRef };
      this.expired = false;
      saveSession('token', this.token);
      saveSession('user', this.user);
      return data;
    },
    async refresh() {
      const { data } = await api('GET', '/session');
      this.user = { userName: data.userName, login: data.login, role: data.role, screen: data.screen, userRef: data.userRef };
      saveSession('user', this.user);
    },
    async logout() {
      try { if (this.token) await api('DELETE', '/session'); } catch { /* сессия уже недействительна */ }
      this.clear();
    },
    expire() {
      this.clear();
      this.expired = true;
    },
    clear() {
      this.token = null;
      this.user = null;
      saveSession('token', null);
      saveSession('user', null);
    }
  }
});
