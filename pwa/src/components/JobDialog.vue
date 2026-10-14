<script setup>
// Задание «В работе»: опрос GET /jobs/{id}, пока state = running; need_split — повтор с allowSplit=true.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import AppModal from './AppModal.vue';
import { get } from '../api';

const props = defineProps({ job: { type: Object, required: true } });
const emit = defineEmits(['close', 'split']);
const state = ref(props.job);
const error = ref('');
let timer;

async function poll() {
  try {
    state.value = await get('/jobs/' + props.job.id);
  } catch (e) {
    error.value = `${e.code}: ${e.message}`;
    return;
  }
  if (state.value.state === 'running') timer = setTimeout(poll, 1000);
}
onMounted(() => { if (state.value.state === 'running') timer = setTimeout(poll, 500); });
onBeforeUnmount(() => clearTimeout(timer));

const TITLES = { running: 'Выполняется…', need_split: 'Нужно подтверждение сплита', done: 'Готово', failed: 'Ошибка' };
const CLS = { running: 'warn', need_split: 'warn', done: 'ok', failed: 'err' };
</script>

<template>
  <AppModal title="В работе" @close="emit('close')">
    <p><span :class="['chip', CLS[state.state]]">{{ TITLES[state.state] || state.state }}</span>
      <span class="muted"> задание {{ job.id }}</span></p>
    <pre v-if="state.message">{{ state.message }}</pre>
    <p v-if="error" class="err">{{ error }}</p>
    <template #actions>
      <button v-if="state.state === 'need_split'" class="primary" @click="emit('split')">Разделить заказ и продолжить</button>
      <button @click="emit('close')">{{ state.state === 'running' ? 'Скрыть' : 'Закрыть' }}</button>
    </template>
  </AppModal>
</template>
