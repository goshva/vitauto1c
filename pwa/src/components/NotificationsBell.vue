<script setup>
// Уведомления роли АРМ (АРМ v2.23, блок 2): счётчик в шапке, раз в минуту; список и «Отметить прочитанными».
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { get, post } from '../api';
import { useToastStore } from '../stores/toast';
import AppIcon from './AppIcon.vue';
import AppModal from './AppModal.vue';

const toast = useToastStore();
const items = ref([]);
const open = ref(false);
const busy = ref(false);
let timer = null;

async function load() {
  try { items.value = (await get('/notifications')).items || []; } catch { /* счётчик не мешает работе: повтор через минуту */ }
}
async function markRead(list) {
  busy.value = true;
  try {
    await post('/notifications/read', { ids: list.map(n => n.id) });
    items.value = items.value.filter(n => !list.includes(n));
    if (!items.value.length) open.value = false;
  } catch (e) {
    toast.show(e.message || 'Не удалось отметить уведомления', 'error');
  } finally { busy.value = false; }
}
const when = d => (d ? d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16) : '');

onMounted(() => { load(); timer = setInterval(load, 60000); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <button class="icon bell" :aria-label="`Уведомления: ${items.length}`" title="Уведомления" @click="load(); open = true">
    <AppIcon name="bell" />
    <span v-if="items.length" class="nav-badge">{{ items.length }}</span>
  </button>
  <AppModal v-if="open" title="Уведомления" side @close="open = false">
    <p v-if="!items.length" class="muted">Новых уведомлений нет.</p>
    <div v-for="n in items" :key="n.id" class="notice">
      <div class="row" style="gap: 8px">
        <span class="chip info">{{ n.node }}</span>
        <b class="grow">{{ n.kind }}</b>
        <span class="muted small">{{ when(n.date) }}</span>
      </div>
      <div class="small" style="margin: 4px 0 6px">{{ n.text }}</div>
      <button class="small" :disabled="busy" @click="markRead([n])"><AppIcon name="check" /> Прочитано</button>
    </div>
    <template #actions>
      <button v-if="items.length" class="primary" :disabled="busy" @click="markRead(items.slice())"><AppIcon name="check" /> Отметить все прочитанными</button>
      <button @click="open = false">Закрыть</button>
    </template>
  </AppModal>
</template>

<style>
.bell { position: relative; }
.bell .nav-badge { position: absolute; top: 2px; right: 2px; }
.notice { padding: 10px 0; border-bottom: 1px solid var(--line, rgba(127, 127, 127, .2)); }
</style>
