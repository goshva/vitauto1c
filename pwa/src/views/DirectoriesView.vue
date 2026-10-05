<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api';

const route = useRoute();
const router = useRouter();
const DIRS = {
  counterparties: { title: 'Контрагенты', search: true },
  contracts: { title: 'Договоры', owner: true },
  nomenclature: { title: 'Номенклатура', search: true, required: true },
  batches: { title: 'Партии', nomenclature: true },
  'service-types': { title: 'Виды услуг' },
  'payment-forms': { title: 'Формы оплаты' }
};
const name = computed(() => (DIRS[route.params.name] ? route.params.name : 'counterparties'));
const q = ref('');
const ownerId = ref('');
const nomenclatureId = ref('');
const items = ref([]);
const error = ref('');
const loading = ref(false);

async function load() {
  const d = DIRS[name.value];
  error.value = '';
  if (d.required && !q.value.trim()) { items.value = []; return; }
  loading.value = true;
  try {
    items.value = await get('/directories/' + name.value, {
      q: d.search ? q.value.trim() : undefined,
      ownerId: d.owner ? ownerId.value : undefined,
      nomenclatureId: d.nomenclature ? nomenclatureId.value : undefined
    });
  } catch (e) {
    items.value = [];
    error.value = `${e.status} ${e.code}: ${e.message}`;
  } finally {
    loading.value = false;
  }
}
watch(name, () => { q.value = ''; load(); }, { immediate: true });
let timer;
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300); });

const keys = computed(() => [...new Set(items.value.flatMap(i => Object.keys(i)))]);
function useAsOwner(it) {
  if (name.value === 'counterparties') { ownerId.value = it.id; router.push('/directories/contracts'); }
  if (name.value === 'nomenclature') { nomenclatureId.value = it.id; router.push('/directories/batches'); }
}
</script>

<template>
  <section class="col">
    <div class="row">
      <RouterLink v-for="(d, k) in DIRS" :key="k" :to="'/directories/' + k" :class="['btn', { primary: k === name }]">{{ d.title }}</RouterLink>
    </div>
    <div class="row">
      <input v-if="DIRS[name].search" v-model="q" placeholder="Поиск" />
      <label v-if="DIRS[name].owner">ownerId <input v-model="ownerId" size="38" placeholder="uuid контрагента" /></label>
      <label v-if="DIRS[name].nomenclature">nomenclatureId <input v-model="nomenclatureId" size="38" placeholder="uuid номенклатуры" /></label>
      <button @click="load" :disabled="loading">Обновить</button>
      <span class="muted">GET /directories/{{ name }} · {{ items.length }}</span>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="DIRS[name].required && !q" class="muted">Номенклатура ищется по строке (параметр q обязателен).</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th v-for="k in keys" :key="k">{{ k }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="it in items" :key="it.id">
            <td v-for="k in keys" :key="k">{{ it[k] }}</td>
            <td>
              <button v-if="name === 'counterparties'" class="link" @click="useAsOwner(it)">договоры →</button>
              <button v-if="name === 'nomenclature'" class="link" @click="useAsOwner(it)">партии →</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
