<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useSessionStore, DEFAULT_BASE } from '../stores/session';
import AppIcon from '../components/AppIcon.vue';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const login = ref('arm.manager');
const password = ref('');
const show = ref(false);
const baseUrl = ref(session.baseUrl);
const error = ref('');
const busy = ref(false);
const TEST_USERS = ['arm.manager', 'arm.storekeeper', 'arm.supply', 'arm.admin', 'arm.mechanic', 'Админ'];

async function submit() {
  error.value = '';
  busy.value = true;
  session.setBaseUrl(baseUrl.value.trim());
  try {
    await session.login(login.value.trim(), password.value);
    router.replace(route.query.next || '/');
  } catch (e) {
    error.value = e.status === 401
      ? `401 unauthorized: неверный логин или пароль пользователя 1С (${login.value.trim()})`
      : `${e.status || ''} ${e.code}: ${e.message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="card col login" @submit.prevent="submit">
      <div class="logo"><AppIcon name="layers" :size="28" /></div>
      <div>
        <h1>Вход в АРМ</h1>
        <p class="muted small" style="margin: 0">Закупки и продажи · 1С через OData</p>
      </div>
      <label class="field">Логин (пользователь ИБ 1С)
        <input v-model="login" list="test-users" autocomplete="username" autocapitalize="none" required />
        <datalist id="test-users"><option v-for="u in TEST_USERS" :key="u" :value="u" /></datalist>
      </label>
      <label class="field">Пароль
        <span class="pw">
          <input v-model="password" :type="show ? 'text' : 'password'" autocomplete="current-password" />
          <button type="button" class="icon" :aria-label="show ? 'Скрыть пароль' : 'Показать пароль'" @click="show = !show"><AppIcon name="eye" :size="20" /></button>
        </span>
      </label>
      <p v-if="error" class="err" role="alert" style="margin: 0">{{ error }}</p>
      <button class="primary block" style="min-height: 48px" :disabled="busy">{{ busy ? 'Вход…' : 'Войти' }}</button>
      <details>
        <summary class="muted small">Подключение</summary>
        <label class="field" style="margin-top: 8px">Адрес OData
          <input v-model="baseUrl" :placeholder="DEFAULT_BASE" autocapitalize="none" />
        </label>
        <p class="muted small">По умолчанию <code>{{ DEFAULT_BASE }}</code> — прокси на стандартный интерфейс OData публикации 1С (ODATA_TARGET).</p>
      </details>
      <p class="faint small" style="margin: 0">Роль — из регистра Арм_ПраваПользователей. Тестовые: arm.manager, arm.storekeeper, arm.supply, arm.admin, arm.mechanic (пароль 1).</p>
    </form>
  </div>
</template>

<style scoped>
.login-wrap { min-height: calc(100dvh - 64px); display: grid; place-items: center; padding: 16px 0; }
.login { width: min(400px, 100%); gap: 16px; padding: 24px; border-radius: var(--r-l); }
.login h1 { margin: 0 0 2px; }
.logo { width: 52px; height: 52px; border-radius: 16px; background: var(--accent); color: var(--accent-fg); display: grid; place-items: center; }
.pw { position: relative; display: block; }
.pw input { padding-right: 48px; }
.pw button { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
summary { cursor: pointer; }
</style>
