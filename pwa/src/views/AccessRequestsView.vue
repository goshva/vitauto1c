<script setup>
// Запросы доступа (M13→A3): администратор видит запросы действий вне матрицы и решает — одобрить/отклонить.
import { ref, onMounted } from 'vue';
import { get, post } from '../api';
import { useToastStore } from '../stores/toast';
import AppIcon from '../components/AppIcon.vue';

const toast = useToastStore();
const items = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try { items.value = await get('/access-requests') || []; } catch (e) { toast.error(e); } finally { loading.value = false; }
}
async function decide(r, approved) {
  const note = approved ? '' : (prompt('Причина отказа (увидит автор запроса):', '') ?? '');
  if (!approved && note === '') return;
  try {
    await post(`/access-requests/${r.id}/decide`, { approved, note });
    toast.show(approved ? 'Одобрено' : 'Отклонено', 'ok');
    await load();
  } catch (e) { toast.error(e); }
}
const when = d => (d ? d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16) : '');
onMounted(load);
</script>

<template>
  <section class="access">
    <div class="chips">
      <button class="chip" :disabled="loading" @click="load"><AppIcon name="refresh" :size="14" /> Обновить</button>
    </div>
    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="!items.length" class="empty">
      <div class="big"><AppIcon name="lock" :size="40" /></div>
      <div>Запросов доступа нет</div>
    </div>
    <div v-for="r in items" :key="r.id" class="card">
      <div class="row" style="gap: 8px">
        <b class="grow">{{ r.action }}</b>
        <span :class="['chip', r.status === 'approved' ? 'ok' : r.status === 'denied' ? 'err' : 'warn']">
          {{ r.status === 'approved' ? 'одобрен' : r.status === 'denied' ? 'отклонён' : 'новый' }}
        </span>
      </div>
      <div class="muted small">роль: {{ r.requesterRole }} · {{ when(r.createdAt) }}<template v-if="r.reason"> · {{ r.reason }}</template></div>
      <div v-if="r.decisionNote" class="muted small">Решение: {{ r.decisionNote }}</div>
      <div v-if="r.status === 'new'" class="row" style="gap: 8px; margin-top: 6px">
        <button class="primary small" @click="decide(r, true)"><AppIcon name="check" :size="16" /> Одобрить</button>
        <button class="small danger" @click="decide(r, false)"><AppIcon name="x" :size="16" /> Отклонить</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.access { display: flex; flex-direction: column; gap: 8px; }
.access .card { display: flex; flex-direction: column; gap: 2px; }
</style>
