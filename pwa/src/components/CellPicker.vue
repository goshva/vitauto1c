<script setup>
// Выбор ячейки размещения (K2, ФФ9): GET /cells — код, зона, склад, свободные строки; заблокированные — не выбираются.
import { ref, onMounted } from 'vue';
import AppModal from './AppModal.vue';
import AppIcon from './AppIcon.vue';
import { get } from '../api';
import { useToastStore } from '../stores/toast';

const props = defineProps({ warehouseId: { type: String, default: '' }, title: { type: String, default: 'Ячейка размещения' } });
const emit = defineEmits(['pick', 'close']);
const toast = useToastStore();
const items = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try { items.value = await get('/cells', { warehouseId: props.warehouseId || undefined }); } catch (e) { toast.error(e); } finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <AppModal :title="title" @close="emit('close')">
    <div v-if="loading" class="muted" style="padding: 8px 2px">Загрузка…</div>
    <div v-else-if="!items.length" class="muted" style="padding: 8px 2px">Ячеек нет — заведите в справочнике или снимите фильтр склада</div>
    <div class="menu">
      <button v-for="c in items" :key="c.id" :disabled="c.blocked" @click="emit('pick', c)">
        <AppIcon name="box" /> {{ c.code }}
        <span v-if="c.zone" class="muted">· {{ c.zone }}</span>
        <span class="hint">{{ c.blocked ? 'заблокирована' : `строк: ${c.free}` }}</span>
      </button>
    </div>
    <template #actions>
      <button @click="load"><AppIcon name="refresh" /> Обновить</button>
      <button @click="emit('close')">Отмена</button>
    </template>
  </AppModal>
</template>
