import { createRouter, createWebHistory } from 'vue-router';
import { useSessionStore } from './stores/session';

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', redirect: () => {
      const s = useSessionStore();
      return { name: 'lines', params: { view: s.isSupply ? 'supply' : 'sales' } };
    } },
  { path: '/lines/:view(sales|purchases|supply)', name: 'lines', component: () => import('./views/LinesView.vue') },
  { path: '/import', name: 'import', component: () => import('./views/ImportView.vue') },
  { path: '/documents/:kind/:id', name: 'document', component: () => import('./views/DocumentView.vue') },
  { path: '/directories/:name?', name: 'directories', component: () => import('./views/DirectoriesView.vue') },
  { path: '/matrix', name: 'matrix', component: () => import('./views/MatrixView.vue') },
  { path: '/console', name: 'console', component: () => import('./views/ConsoleView.vue') },
  { path: '/log', name: 'log', component: () => import('./views/LogView.vue'), meta: { public: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(to => {
  const s = useSessionStore();
  if (!to.meta.public && !s.loggedIn) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'lines' && s.loggedIn && !s.views.includes(to.params.view)) {
    return { name: 'lines', params: { view: s.views[0] } };
  }
});

export default router;
