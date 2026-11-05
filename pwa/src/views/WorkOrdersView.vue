<script setup>
// Заказ-наряды автосервиса (G1–G9): список, детали, выдача авто (G9), печать (work_order), создание из строки ремонта.
import { ref, onMounted, computed } from 'vue';
import { get, post } from '../api';
import { useSessionStore } from '../stores/session';
import { useToastStore } from '../stores/toast';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';

const session = useSessionStore();
const toast = useToastStore();
const items = ref([]);
const loading = ref(false);
const detail = ref(null);
const canEdit = computed(() => ['chief_mechanic', 'admin'].includes(session.role));

async function load() {
  loading.value = true;
  try { items.value = await get('/work-orders') || []; } catch (e) { toast.error(e); } finally { loading.value = false; }
}
async function open(wo) {
  try { detail.value = await get('/work-orders/' + wo.id); } catch (e) { toast.error(e); }
}
async function release(wo) {
  if (!confirm(`Выдать авто по заказ-наряду ${wo.number}?`)) return;
  try { await post(`/work-orders/${wo.id}/release`, {}); toast.show('Заказ-наряд закрыт, авто выдан', 'ok'); await load(); detail.value = null; } catch (e) { toast.error(e); }
}
async function printWO(wo) {
  const win = window.open('', '_blank');
  try {
    const { html } = await post('/print', { kind: 'work_order', workOrderIds: [wo.id] });
    if (!win) { toast.show('Браузер заблокировал окно печати', 'error'); return; }
    win.document.open(); win.document.write(html); win.document.close(); win.focus(); win.print();
  } catch (e) { if (win) win.close(); toast.error(e); }
}
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const d = v => (v ? String(v).slice(0, 10) : '');
onMounted(load);
</script>

<template>
  <section class="wos">
    <div class="chips">
      <button class="chip" :disabled="loading" @click="load"><AppIcon name="refresh" :size="14" /> Обновить</button>
    </div>
    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="!items.length" class="empty">
      <div class="big"><AppIcon name="wrench" :size="40" /></div>
      <div>Заказ-нарядов нет</div>
      <div class="muted small">Создание: карточка строки ремонта → «Заказ-наряд» (G1)</div>
    </div>
    <div v-for="w in items" :key="w.id" class="card">
      <div class="row" style="gap: 8px">
        <button class="link grow" style="text-align: left" @click="open(w)"><b>ЗН {{ w.number }}</b></button>
        <span :class="['chip', w.status === 'released' ? 'ok' : 'warn']">{{ w.status === 'released' ? 'выдан' : 'в работе' }}</span>
      </div>
      <div class="muted small">{{ d(w.date) }} · нормо-часов {{ money.format(w.totalNormHours) }}</div>
      <div class="row" style="gap: 8px; margin-top: 6px">
        <button v-if="w.status === 'open' && canEdit" class="primary small" @click="release(w)"><AppIcon name="check" :size="16" /> Выдать авто</button>
        <button class="small" @click="printWO(w)"><AppIcon name="file" :size="16" /> Печать</button>
      </div>
    </div>

    <AppModal v-if="detail" :title="`Заказ-наряд ${detail.number}`" side @close="detail = null">
      <div class="muted small" style="margin-bottom: 6px">{{ detail.date }} · {{ detail.status === 'released' ? 'выдан' : 'в работе' }} · нормо-часов {{ money.format(detail.totalNormHours) }}<template v-if="detail.laborSum"> · работы {{ money.format(detail.laborSum) }}</template><template v-if="detail.partsSum"> · запчасти {{ money.format(detail.partsSum) }}</template></div>
      <div class="menu-title">Позиции</div>
      <table>
        <thead><tr><th>Артикул / позиция</th><th>Кол-во</th><th>н/ч</th><th>Статус строки</th></tr></thead>
        <tbody>
          <tr v-for="l in detail.lines" :key="l.id">
            <td>{{ l.nomenclatureName || String(l.nomenclatureId || '').slice(0, 8) }}</td>
            <td class="n">{{ money.format(l.quantity) }}</td>
            <td class="n">{{ money.format(l.normHours) }}</td>
            <td><span v-if="l.lineStatus" class="chip">{{ l.lineStatus }}</span></td>
          </tr>
        </tbody>
      </table>
      <template #actions>
        <button v-if="detail.status === 'open' && canEdit" class="primary" @click="release(detail)"><AppIcon name="check" /> Выдать авто</button>
        <button @click="detail = null">Закрыть</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.wos { display: flex; flex-direction: column; gap: 8px; }
.wos .card { display: flex; flex-direction: column; gap: 2px; }
td.n { text-align: right; white-space: nowrap; }
</style>
