<script setup>
// POST /sales/imports — лист покупателя: строки вставляются из Excel (табуляция) или CSV (;).
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { post } from '../api';
import { useToastStore } from '../stores/toast';
import RefPicker from '../components/RefPicker.vue';
import AppIcon from '../components/AppIcon.vue';

const router = useRouter();
const toast = useToastStore();
const COLS = ['clientNumber', 'urgency', 'plate', 'territory', 'article', 'name', 'quantity'];
const TITLES = ['№ заказа клиента', 'Срочность', 'ГРЗ', 'Территория', 'Артикул', 'Наименование', 'Кол-во'];

const customer = ref(null);
const contract = ref(null);
const pick = ref(null);
const text = ref('З-101\tсрочно\tА123ВС77\tСклад 1\tOC-90\tФильтр масляный\t2\nЗ-101\t\tА123ВС77\tСклад 1\tBKR6E\tСвеча зажигания\t4');
const busy = ref(false);

const rows = computed(() => text.value.split(/\r?\n/).filter(s => s.trim()).map(s => {
  const parts = s.split(s.includes('\t') ? '\t' : ';');
  return Object.fromEntries(COLS.map((c, i) => [c, (parts[i] || '').trim()]));
}));

async function submit() {
  busy.value = true;
  try {
    const doc = await post('/sales/imports', { customerId: customer.value.id, contractId: contract.value ? contract.value.id : undefined, rows: rows.value });
    toast.show(`Создан заказ ${doc.number} (${rows.value.length} строк)`, 'ok');
    router.push({ name: 'document', params: { kind: 'customer_order', id: doc.id } });
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="page import">
    <p class="muted small" style="margin: 0">Лист покупателя → новый заказ: строки клиента попадают в АРМ (узлы N1, M1). Вставьте строки из Excel.</p>
    <div class="imp-grid">
      <label class="field">Заказчик
        <button @click="pick = 'customer'">{{ customer ? customer.name : 'Выбрать…' }} <AppIcon name="right" :size="18" /></button>
      </label>
      <label class="field">Договор
        <button :disabled="!customer" @click="pick = 'contract'">{{ contract ? contract.name : 'По умолчанию' }} <AppIcon name="right" :size="18" /></button>
      </label>
    </div>
    <label class="field">Строки — колонки через Tab или «;»
      <textarea v-model="text" rows="7" spellcheck="false"></textarea>
      <span class="faint small" style="font-weight: 400">{{ TITLES.join(' · ') }}</span>
    </label>

    <div class="menu-title" style="padding-left: 0">Предпросмотр: {{ rows.length }} стр.</div>
    <div class="imp-rows">
      <div v-for="(r, i) in rows" :key="i" class="card imp-row">
        <div class="row" style="justify-content: space-between; flex-wrap: nowrap">
          <b class="grow">{{ r.name || 'без наименования' }}</b>
          <span class="chip info">× {{ r.quantity || '—' }}</span>
        </div>
        <div class="muted small">
          <span v-if="r.article">арт. {{ r.article }}</span>
          <span v-if="r.clientNumber"> · № {{ r.clientNumber }}</span>
          <span v-if="r.plate"> · {{ r.plate }}</span>
          <span v-if="r.territory"> · {{ r.territory }}</span>
          <span v-if="r.urgency" class="warn"> · {{ r.urgency }}</span>
        </div>
      </div>
    </div>

    <div class="imp-submit">
      <button class="primary block" style="min-height: 48px" :disabled="!customer || !rows.length || busy" @click="submit">
        <AppIcon name="upload" :size="18" /> {{ busy ? 'Загрузка…' : `Создать заказ (${rows.length})` }}
      </button>
    </div>

    <RefPicker v-if="pick === 'customer'" dir="counterparties" title="Заказчик"
               @pick="v => { customer = v; contract = null; pick = null }" @close="pick = null" />
    <RefPicker v-if="pick === 'contract'" dir="contracts" :query="{ ownerId: customer.id }" title="Договор"
               @pick="v => { contract = v; pick = null }" @close="pick = null" />
  </section>
</template>

<style scoped>
.import { max-width: 900px; }
.imp-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 640px) { .imp-grid { grid-template-columns: 1fr 1fr; } }
.imp-rows { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }
.imp-row { padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
.warn { color: var(--warn); }
.imp-submit { position: sticky; bottom: calc(var(--nav-h) + var(--safe-b) + 8px); padding-top: 8px; }
@media (min-width: 900px) { .imp-submit { position: static; max-width: 320px; } }
</style>
