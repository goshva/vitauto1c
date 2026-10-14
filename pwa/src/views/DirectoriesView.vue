<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api';
import AppIcon from '../components/AppIcon.vue';

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

const extra = it => Object.entries(it).filter(([k, v]) => !['id', 'name'].includes(k) && v !== '' && v != null);
function useAsOwner(it) {
  if (name.value === 'counterparties') { ownerId.value = it.id; router.push('/directories/contracts'); }
  if (name.value === 'nomenclature') { nomenclatureId.value = it.id; router.push('/directories/batches'); }
}
</script>

<template>
  <section class="page">
    <div class="chips" role="tablist" aria-label="Справочник">
      <RouterLink v-for="(d, k) in DIRS" :key="k" :to="'/directories/' + k" role="tab" :aria-selected="k === name"
                  :class="['btn', 'chip', { on: k === name }]">{{ d.title }}</RouterLink>
    </div>
    <div class="row">
      <div v-if="DIRS[name].search" class="search"><span class="ico"><AppIcon name="search" :size="18" /></span>
        <input v-model="q" type="search" :placeholder="DIRS[name].required ? 'Наименование, артикул или код' : 'Поиск'" /></div>
      <label v-if="DIRS[name].owner" class="field grow">Контрагент (uuid) <input v-model="ownerId" placeholder="выберите в «Контрагентах» → договоры" /></label>
      <label v-if="DIRS[name].nomenclature" class="field grow">Номенклатура (uuid) <input v-model="nomenclatureId" placeholder="выберите в «Номенклатуре» → партии" /></label>
      <button class="icon" aria-label="Обновить" @click="load" :disabled="loading"><AppIcon name="refresh" /></button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="muted small">{{ loading ? 'Загрузка…' : `Найдено: ${items.length}` }}</div>
    <div v-if="DIRS[name].required && !q" class="empty"><div class="big"><AppIcon name="search" :size="40" /></div>Номенклатура ищется по строке</div>
    <div v-else class="list" style="max-height: none">
      <div v-for="it in items" :key="it.id" class="item dir-item">
        <div class="grow">
          <div>{{ it.name }}</div>
          <div class="faint small"><span v-for="[k, v] in extra(it)" :key="k">{{ k }}: {{ v }} · </span><span>{{ it.id }}</span></div>
        </div>
        <button v-if="name === 'counterparties'" class="sm tonal" @click="useAsOwner(it)">Договоры</button>
        <button v-if="name === 'nomenclature'" class="sm tonal" @click="useAsOwner(it)">Партии</button>
      </div>
      <div v-if="!items.length && !loading" class="item muted">Пусто</div>
    </div>
  </section>
</template>

<style scoped>
.dir-item { cursor: default; }
.dir-item:hover { background: none; }
.dir-item .small { overflow-wrap: anywhere; }
</style>
