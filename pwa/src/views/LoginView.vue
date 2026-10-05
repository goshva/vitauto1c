<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useSessionStore, DEFAULT_BASE } from '../stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const login = ref('arm.manager');
const password = ref('');
const baseUrl = ref(session.baseUrl);
const error = ref('');
const busy = ref(false);
const TEST_USERS = ['arm.manager', 'arm.storekeeper', 'arm.supply'];

async function submit() {
  error.value = '';
  busy.value = true;
  session.setBaseUrl(baseUrl.value.trim());
  try {
    await session.login(login.value.trim(), password.value);
    router.replace(route.query.next || '/');
  } catch (e) {
    error.value = `${e.status || ''} ${e.code}: ${e.message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card col login" @submit.prevent="submit">
    <h1>Вход в АРМ</h1>
    <label class="col">Логин (пользователь ИБ 1С)
      <input v-model="login" list="test-users" autocomplete="username" required />
      <datalist id="test-users"><option v-for="u in TEST_USERS" :key="u" :value="u" /></datalist>
    </label>
    <label class="col">Пароль
      <input v-model="password" type="password" autocomplete="current-password" />
    </label>
    <details>
      <summary class="muted">Адрес API</summary>
      <label class="col">Базовый URL
        <input v-model="baseUrl" :placeholder="DEFAULT_BASE" />
      </label>
      <p class="muted">По умолчанию <code>{{ DEFAULT_BASE }}</code> — прокси Vite на публикацию 1С (ARM_API_TARGET).</p>
    </details>
    <p v-if="error" class="err">{{ error }}</p>
    <button class="primary" :disabled="busy">{{ busy ? 'Вход…' : 'Войти' }}</button>
    <p class="muted">Тестовые пользователи: arm.manager, arm.storekeeper, arm.supply (пароль 1).</p>
  </form>
</template>

<style scoped>
.login { max-width: 380px; margin: 10vh auto; }
.login label.col { align-items: stretch; }
</style>
