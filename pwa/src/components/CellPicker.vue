<script setup>
// Выбор ячейки размещения (K2, ФФ9): GET /cells — код, зона, склад, свободные строки.
// Зона склада — фильтр над списком: шесть предопределённых зон (ТЗ 2.4).
import { ref, computed, onMounted } from 'vue';
import AppModal from './AppModal.vue';
import AppIcon from './AppIcon.vue';
import { get } from '../api';
import { useToastStore } from '../stores/toast';

const props = defineProps({ warehouseId: { type: String, default: '' }, title: { type: String, default: 'Ячейка размещения' } });
const emit = defineEmits(['pick', 'close']);
const toast = useToastStore();
const items = ref([]);
const zones = ref([]);
const zoneId = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try { items.value = await get('/cells', { warehouseId: props.warehouseId || undefined }); } catch (e) { toast.error(e); } finally { loading.value = false; }
}
async function loadZones() {
  try { zones.value = await get('/directories/zones'); } catch (e) { toast.error(e); }
}
const shown = computed(() => (zoneId.value ? items.value.filter(c => c.zoneId === zoneId.value) : items.value));
onMounted(() => { load(); loadZones(); });
</script>

<template>
  <AppModal :title="title" @close="emit('close')">
    <div v-if="zones.length" class="chips" role="group" aria-label="Зона склада">
      <button class="chip" :class="{ on: !zoneId }" @click="zoneId = ''">Все зоны</button>
      <button v-for="z in zones" :key="z.id" class="chip" :class="{ on: zoneId === z.id }" @click="zoneId = z.id">{{ z.code }} · {{ z.name }}</button>
    </div>
    <div v-if="loading" class="muted" style="padding: 8px 2px">Загрузка…</div>
    <div v-else-if="!shown.length" class="muted" style="padding: 8px 2px">Ячеек нет — заведите в справочнике или снимите фильтр склада/зоны</div>
    <div class="menu">
      <button v-for="c in shown" :key="c.id" :disabled="c.blocked" @click="emit('pick', c)">
        <AppIcon name="box" /> {{ c.code }}
        <span v-if="c.zoneName || c.zone" class="muted">· {{ c.zoneName || c.zone }}</span>
        <span class="hint">{{ c.blocked ? 'заблокирована' : `строк: ${c.free}` }}</span>
      </button>
    </div>
    <template #actions>
      <button @click="load"><AppIcon name="refresh" /> Обновить</button>
      <button @click="emit('close')">Отмена</button>
    </template>
  </AppModal>
</template>
