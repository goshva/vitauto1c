<script setup>
// Возвраты (C1/C2, M16, K6): список doc.return_order, проведение (движение склада + строки в «Возврат»), отмена.
// Создание — из списка строк («Действия» → «Возврат по отмеченным»).
import { ref, onMounted } from 'vue';
import { get, post, api } from '../api';
import { useToastStore } from '../stores/toast';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';

const toast = useToastStore();
const items = ref([]);
const loading = ref(false);
const detail = ref(null);

async function load() {
  loading.value = true;
  try { items.value = await get('/returns') || []; } catch (e) { toast.error(e); } finally { loading.value = false; }
}
async function open(r) {
  try { detail.value = await get('/returns/' + r.id); } catch (e) { toast.error(e); }
}
async function doPost(r) {
  try { const res = await post(`/returns/${r.id}/post`, {}); toast.show(`Проведён, движений: ${res.moved}`, 'ok'); await load(); } catch (e) { toast.error(e); }
}
async function cancel(r) {
  if (!confirm(`Отменить возврат ${r.number}?`)) return;
  try { await api('POST', `/returns/${r.id}/cancel`); toast.show('Отменён', 'ok'); await load(); } catch (e) { toast.error(e); }
}
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const d = v => (v ? String(v).slice(0, 10) : '');
onMounted(load);
</script>

<template>
  <section class="returns">
    <div class="chips">
      <button class="chip" :disabled="loading" @click="load"><AppIcon name="refresh" :size="14" /> Обновить</button>
    </div>
    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="!items.length" class="empty">
      <div class="big"><AppIcon name="undo" :size="40" /></div>
      <div>Возвратов нет</div>
      <div class="muted small">Создание: список строк → отметить → «Действия» → «Возврат по отмеченным»</div>
    </div>
    <div v-for="r in items" :key="r.id" class="card">
      <div class="row" style="gap: 8px">
        <button class="link grow" style="text-align: left" @click="open(r)"><b>Возврат {{ r.number }}</b></button>
        <span :class="['chip', r.posted ? 'ok' : 'warn']">{{ r.posted ? 'проведён' : 'черновик' }}</span>
      </div>
      <div class="muted small">{{ d(r.date) }} · {{ r.operation === 'Закупка' ? 'поставщику' : 'от клиента' }} · кол-во {{ money.format(r.totalQty) }} · сумма {{ money.format(r.totalSum) }}</div>
      <div class="row" style="gap: 8px; margin-top: 6px">
        <button v-if="!r.posted" class="primary small" @click="doPost(r)"><AppIcon name="check" :size="16" /> Провести</button>
        <button v-if="!r.posted" class="small danger" @click="cancel(r)"><AppIcon name="x" :size="16" /> Отменить</button>
      </div>
    </div>

    <AppModal v-if="detail" :title="`Возврат ${detail.number}`" side @close="detail = null">
      <div class="muted small" style="margin-bottom: 6px">{{ detail.date }} · {{ detail.operation === 'Закупка' ? 'возврат поставщику' : 'возврат от клиента' }} · {{ detail.posted ? 'проведён' : 'черновик' }}</div>
      <table>
        <thead><tr><th>№</th><th>Позиция</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Причина</th></tr></thead>
        <tbody>
          <tr v-for="l in detail.lines" :key="l.id">
            <td>{{ l.sortOrder }}</td><td>{{ l.nomenclatureId && String(l.nomenclatureId).slice(0, 8) }}</td>
            <td class="n">{{ money.format(l.quantity) }}</td><td class="n">{{ money.format(l.costPrice) }}</td>
            <td class="n">{{ money.format(l.costSum) }}</td><td>{{ l.reason }}</td>
          </tr>
        </tbody>
      </table>
      <template #actions><button @click="detail = null">Закрыть</button></template>
    </AppModal>
  </section>
</template>

<style scoped>
.returns { display: flex; flex-direction: column; gap: 8px; }
.returns .card { display: flex; flex-direction: column; gap: 2px; }
td.n { text-align: right; white-space: nowrap; }
</style>
