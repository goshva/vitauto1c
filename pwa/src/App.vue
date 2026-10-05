<script setup>
import { watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useSessionStore } from './stores/session';
import { useLogStore } from './stores/log';
import { useToastStore } from './stores/toast';

const session = useSessionStore();
const log = useLogStore();
const toast = useToastStore();
const router = useRouter();
const route = useRoute();

const VIEW_TITLES = { sales: 'Продажи', purchases: 'Закупки', supply: 'Снабжение' };
const ROLE_TITLES = { manager: 'менеджер', storekeeper: 'кладовщик', chief_mechanic: 'гл. механик', admin: 'администратор', supplier: 'поставщик', client: 'клиент', supply: 'снабжение' };

// Сессия истекла (401) — на вход
watch(() => session.expired, v => {
  if (v) {
    toast.show('Сессия истекла — войдите заново', 'error');
    router.push({ name: 'login', query: { next: route.fullPath } });
  }
});

async function logout() {
  await session.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <header class="topbar" v-if="session.loggedIn">
    <RouterLink to="/" class="brand">АРМ API</RouterLink>
    <nav>
      <RouterLink v-for="v in session.views" :key="v" :to="{ name: 'lines', params: { view: v } }">{{ VIEW_TITLES[v] }}</RouterLink>
      <RouterLink v-if="!session.isSupply" to="/import">Загрузка</RouterLink>
      <RouterLink to="/directories">Справочники</RouterLink>
      <RouterLink to="/matrix">Матрица</RouterLink>
      <RouterLink to="/console">Консоль</RouterLink>
      <RouterLink to="/log">Журнал<span v-if="log.errors" class="badge">{{ log.errors }}</span></RouterLink>
    </nav>
    <div class="who">
      <span :title="session.user.login">{{ session.user.userName }} · {{ ROLE_TITLES[session.role] || session.role }}</span>
      <button class="link" @click="logout">Выйти</button>
    </div>
  </header>
  <main>
    <RouterView />
  </main>
  <div class="toasts">
    <div v-for="t in toast.items" :key="t.id" :class="['toast', t.kind]" @click="toast.dismiss(t.id)">{{ t.text }}</div>
  </div>
</template>
