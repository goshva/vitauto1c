<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useSessionStore } from './stores/session';
import { useLogStore } from './stores/log';
import { useToastStore } from './stores/toast';
import { useUiStore } from './stores/ui';
import AppIcon from './components/AppIcon.vue';
import AppModal from './components/AppModal.vue';

const session = useSessionStore();
const log = useLogStore();
const toast = useToastStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();
ui.init();

const VIEW_TITLES = { sales: 'Продажи', purchases: 'Закупки', supply: 'Снабжение' };
const ROLE_TITLES = { manager: 'Менеджер', storekeeper: 'Кладовщик', chief_mechanic: 'Гл. механик', admin: 'Администратор', supplier: 'Поставщик', client: 'Клиент' };
const PAGE_TITLES = { import: 'Загрузка листа', directories: 'Справочники', matrix: 'Матрица прав', console: 'Консоль API', log: 'Журнал запросов', document: 'Документ' };

// Навигация: основные пункты — в нижней панели телефона, остальные — в «Ещё»; на ПК всё в боковой панели
const nav = computed(() => [
  ...session.views.map(v => ({ to: { name: 'lines', params: { view: v } }, title: VIEW_TITLES[v], icon: v, main: true })),
  { to: '/import', title: 'Загрузка', icon: 'upload', main: true },   // в АРМ загрузка заявки не ограничена ролью
  { to: '/catalog/goods', title: 'Товары', icon: 'tag' },
  { to: '/catalog/services', title: 'Услуги', icon: 'wrench' },
  { to: '/catalog/cars', title: 'Машины', icon: 'car' },
  { to: '/directories', title: 'Справочники', icon: 'book' },
  // отладочные экраны — только администратору АРМ
  ...(session.isAdmin ? [{ to: '/matrix', title: 'Матрица', icon: 'grid' }, { to: '/console', title: 'Консоль', icon: 'terminal' }] : []),
  { to: '/log', title: 'Журнал', icon: 'activity', badge: log.errors }
]);
const more = ref(false);
const moreActive = computed(() => nav.value.some(n => !n.main && typeof n.to === 'string' && route.path.startsWith(n.to)));

const CATALOG_TITLES = { goods: 'Товары', services: 'Услуги', cars: 'Машины' };
const title = computed(() => (route.name === 'lines' ? VIEW_TITLES[route.params.view]
  : route.name === 'catalog' ? CATALOG_TITLES[route.params.kind] : PAGE_TITLES[route.name] || 'АРМ'));

// Сессия истекла (401) — на вход
watch(() => session.expired, v => {
  if (v) {
    toast.show('Сессия истекла — войдите заново', 'error');
    router.push({ name: 'login', query: { next: route.fullPath } });
  }
});

async function logout() {
  more.value = false;
  await session.logout();
  router.push({ name: 'login' });
}
const THEMES = [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];
</script>

<template>
  <div :class="['app', { 'logged-in': session.loggedIn }]">
    <nav v-if="session.loggedIn" class="navbar" aria-label="Разделы">
      <div class="brand"><span class="logo"><AppIcon name="layers" :size="18" /></span>АРМ</div>
      <RouterLink v-for="n in nav" :key="n.title" :to="n.to" :class="{ 'desk-only': !n.main }">
        <span class="pill"><AppIcon :name="n.icon" /></span>
        <span class="label">{{ n.title }}</span>
        <span v-if="n.badge" class="nav-badge">{{ n.badge }}</span>
      </RouterLink>
      <button class="mob-only" :class="{ active: moreActive }" @click="more = true">
        <span class="pill"><AppIcon name="more" /></span>
        <span class="label">Ещё</span>
        <span v-if="log.errors" class="nav-badge">{{ log.errors }}</span>
      </button>
      <div class="spacer desk-only"></div>
      <button class="desk-only" @click="more = true"><span class="pill"><AppIcon name="sliders" /></span><span class="label">Настройки</span></button>
      <div class="who">
        <b>{{ session.user.userName }}</b>
        <span class="muted">{{ ROLE_TITLES[session.role] || session.role }}</span>
      </div>
    </nav>

    <div class="content">
      <header v-if="session.loggedIn" class="appbar">
        <div class="title">{{ title }}</div>
        <div id="appbar-actions" class="row" style="flex-wrap: nowrap; gap: 2px"></div>
      </header>
      <main :class="['main', { 'no-nav': !session.loggedIn }]">
        <RouterView />
      </main>
    </div>

    <AppModal v-if="more" title="Меню" @close="more = false">
      <div class="row" style="gap: 12px; padding: 4px 4px 8px">
        <span class="chip info" style="width: 44px; height: 44px; border-radius: 50%; justify-content: center; padding: 0"><AppIcon name="user" /></span>
        <div class="grow"><b>{{ session.user && session.user.userName }}</b><div class="muted small">{{ ROLE_TITLES[session.role] || session.role }} · {{ session.user && session.user.login }}</div></div>
      </div>
      <div class="menu">
        <RouterLink v-for="n in nav.filter(x => !x.main)" :key="n.title" :to="n.to" @click="more = false">
          <AppIcon :name="n.icon" /> {{ n.title }} <span v-if="n.badge" class="chip err" style="margin-left: auto">{{ n.badge }}</span>
        </RouterLink>
      </div>
      <div class="menu-title">Тема</div>
      <div class="segmented" role="radiogroup" aria-label="Тема">
        <button v-for="[k, t] in THEMES" :key="k" :class="{ on: ui.theme === k }" role="radio" :aria-checked="ui.theme === k" @click="ui.setTheme(k)">{{ t }}</button>
      </div>
      <div class="menu">
        <button class="danger" @click="logout"><AppIcon name="logout" /> Выйти</button>
      </div>
      <template #actions><span></span></template>
    </AppModal>

    <div class="toasts" role="status" aria-live="polite">
      <div v-for="t in toast.items" :key="t.id" :class="['toast', t.kind]" @click="toast.dismiss(t.id)">{{ t.text }}</div>
    </div>
  </div>
</template>

<style>
.app:not(.logged-in) .main { padding-bottom: 32px; }
.content { min-width: 0; }
.navbar a, .navbar button { text-decoration: none; }
</style>
