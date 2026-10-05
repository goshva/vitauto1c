<script setup>
// Выбор элемента справочника /directories/{dir}: поиск (для counterparties и nomenclature), один или несколько.
import { ref, onMounted, watch } from 'vue';
import AppModal from './AppModal.vue';
import { get } from '../api';
import { useToastStore } from '../stores/toast';

const props = defineProps({
  dir: { type: String, required: true },
  query: { type: Object, default: () => ({}) },
  title: { type: String, default: 'Выбор' },
  multiple: Boolean,
  allowClear: Boolean
});
const emit = defineEmits(['pick', 'close']);
const toast = useToastStore();
const SEARCHABLE = ['counterparties', 'nomenclature'];

const q = ref('');
const items = ref([]);
const loading = ref(false);
const selected = ref([]);

async function load() {
  if (props.dir === 'nomenclature' && !q.value.trim()) { items.value = []; return; }
  loading.value = true;
  try {
    items.value = await get('/directories/' + props.dir, { ...props.query, q: SEARCHABLE.includes(props.dir) ? q.value.trim() : undefined });
  } catch (e) {
    toast.error(e);
  } finally {
    loading.value = false;
  }
}

let timer;
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300); });
onMounted(load);

function click(item) {
  if (!props.multiple) { emit('pick', item); return; }
  const i = selected.value.findIndex(s => s.id === item.id);
  if (i >= 0) selected.value.splice(i, 1); else selected.value.push(item);
}
</script>

<template>
  <AppModal :title="title" @close="emit('close')">
    <input v-if="SEARCHABLE.includes(dir)" v-model="q" :placeholder="dir === 'nomenclature' ? 'Наименование, артикул или код' : 'Поиск'" autofocus />
    <div class="list">
      <div v-if="loading" class="item muted">Загрузка…</div>
      <div v-else-if="!items.length" class="item muted">{{ dir === 'nomenclature' && !q ? 'Введите строку поиска' : 'Ничего не найдено' }}</div>
      <div v-for="it in items" :key="it.id" :class="['item', { sel: selected.some(s => s.id === it.id) }]" @click="click(it)">
        <input v-if="multiple" type="checkbox" :checked="selected.some(s => s.id === it.id)" @click.stop="click(it)" />
        <span>{{ it.name }}</span>
        <span v-if="it.article" class="muted">{{ it.article }}</span>
        <span v-if="it.code" class="muted">{{ it.code }}</span>
        <span v-if="it.unit" class="muted">{{ it.unit }}</span>
      </div>
    </div>
    <template #actions>
      <button v-if="allowClear" class="danger" @click="emit('pick', null)">Очистить</button>
      <button @click="emit('close')">Отмена</button>
      <button v-if="multiple" class="primary" :disabled="!selected.length" @click="emit('pick', selected)">Выбрать ({{ selected.length }})</button>
    </template>
  </AppModal>
</template>
