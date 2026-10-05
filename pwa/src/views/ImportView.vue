<script setup>
// POST /sales/imports — лист покупателя: строки вставляются из Excel (табуляция) или CSV (;).
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { post } from '../api';
import { useToastStore } from '../stores/toast';
import RefPicker from '../components/RefPicker.vue';

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
  <section class="col" style="max-width: 1000px">
    <h1>Загрузка листа покупателя</h1>
    <div class="row">
      <label>Заказчик <button @click="pick = 'customer'">{{ customer ? customer.name : 'выбрать…' }}</button></label>
      <label>Договор <button :disabled="!customer" @click="pick = 'contract'">{{ contract ? contract.name : 'по умолчанию' }}</button></label>
    </div>
    <label class="col" style="align-items: stretch">Строки (колонки через Tab или «;»: {{ TITLES.join(', ') }})
      <textarea v-model="text" rows="8"></textarea>
    </label>
    <div class="table-wrap">
      <table>
        <thead><tr><th v-for="t in TITLES" :key="t">{{ t }}</th></tr></thead>
        <tbody><tr v-for="(r, i) in rows" :key="i"><td v-for="c in COLS" :key="c">{{ r[c] }}</td></tr></tbody>
      </table>
    </div>
    <div><button class="primary" :disabled="!customer || !rows.length || busy" @click="submit">Загрузить ({{ rows.length }})</button></div>

    <RefPicker v-if="pick === 'customer'" dir="counterparties" title="Заказчик"
               @pick="v => { customer = v; contract = null; pick = null }" @close="pick = null" />
    <RefPicker v-if="pick === 'contract'" dir="contracts" :query="{ ownerId: customer.id }" title="Договор"
               @pick="v => { contract = v; pick = null }" @close="pick = null" />
  </section>
</template>
