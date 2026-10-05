<script setup>
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api';
import { useLinesStore } from '../stores/lines';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const router = useRouter();
const lines = useLinesStore();
const session = useSessionStore();
const doc = ref(null);
const error = ref('');
const KINDS = { customer_order: 'Заказ покупателя', supplier_order: 'Заказ поставщику', receipt: 'Приходная накладная', shipment: 'Расходная накладная' };

watch(() => route.params, async p => {
  doc.value = null;
  error.value = '';
  try {
    doc.value = await get(`/documents/${p.kind}/${p.id}`);
  } catch (e) {
    error.value = `${e.status} ${e.code}: ${e.message}`;
  }
}, { immediate: true });

function showLines() {
  lines.filters.customerOrderId = doc.value.id;
  router.push({ name: 'lines', params: { view: session.isSupply ? 'supply' : 'sales' } });
}
</script>

<template>
  <section class="col" style="max-width: 640px">
    <h1>{{ KINDS[route.params.kind] || route.params.kind }}</h1>
    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="doc" class="card col">
      <div><b>№ {{ doc.number }}</b> от {{ doc.date }}
        <span :class="['chip', doc.posted ? 'ok' : '']">{{ doc.posted ? 'проведён' : 'не проведён' }}</span></div>
      <div>Контрагент: {{ doc.counterparty ? doc.counterparty.name : '—' }}</div>
      <div>Договор: {{ doc.contract ? doc.contract.name : '—' }}</div>
      <div v-if="doc.comment">Комментарий: {{ doc.comment }}</div>
      <div class="muted">id {{ doc.id }}</div>
      <div v-if="route.params.kind === 'customer_order'"><button class="primary" @click="showLines">Строки АРМ по заказу</button></div>
    </div>
    <details v-if="doc"><summary class="muted">JSON</summary><pre>{{ JSON.stringify(doc, null, 2) }}</pre></details>
  </section>
</template>
