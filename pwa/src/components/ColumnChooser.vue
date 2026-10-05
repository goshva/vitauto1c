<script setup>
// Настройка видимых колонок списка строк для текущей роли и списка.
import { ref, computed } from 'vue';
import AppModal from './AppModal.vue';
import { useColumnsStore, STAGES, ALWAYS } from '../stores/columns';

const props = defineProps({
  role: { type: String, required: true },
  view: { type: String, required: true },
  columns: { type: Array, required: true }
});
const emit = defineEmits(['close']);
const store = useColumnsStore();
const q = ref('');

const pref = computed(() => store.pref(props.role, props.view));
const selected = computed(() => new Set(store.selectedIds(props.role, props.view, props.columns)));
const list = computed(() => {
  const s = q.value.trim().toLowerCase();
  return props.columns.filter(c => !ALWAYS.includes(c.id))
    .filter(c => !s || (c.code + ' ' + c.title + ' ' + c.field).toLowerCase().includes(s));
});
const stagesByRole = computed(() => {
  const out = {};
  for (const st of STAGES) (out[st.roleTitle] = out[st.roleTitle] || []).push(st);
  return out;
});
const VIEW_TITLES = { sales: 'продажи', purchases: 'закупки', supply: 'снабжение' };

function mode(m) { store.set(props.role, props.view, { mode: m }); }
function stage(e) { store.set(props.role, props.view, { mode: e.target.value ? 'stage' : 'compact', stage: e.target.value || null }); }
function toggle(id) { store.toggle(props.role, props.view, props.columns, id); }
function only(ids) { store.set(props.role, props.view, { mode: 'custom', ids }); }
</script>

<template>
  <AppModal :title="`Колонки: ${VIEW_TITLES[view] || view}, роль ${role}`" @close="emit('close')">
    <div class="row">
      <button :class="{ primary: pref.mode === 'compact' }" @click="mode('compact')">Основные</button>
      <button :class="{ primary: pref.mode === 'mine' }" @click="mode('mine')">Редактируемые ролью</button>
      <button :class="{ primary: pref.mode === 'all' }" @click="mode('all')">Все</button>
      <span v-if="pref.mode === 'custom'" class="chip">свой набор</span>
    </div>
    <label class="col" style="align-items: stretch">Этап процесса (process.html)
      <select :value="pref.mode === 'stage' ? pref.stage : ''" @change="stage">
        <option value="">— не выбран —</option>
        <optgroup v-for="(items, role) in stagesByRole" :key="role" :label="role">
          <option v-for="s in items" :key="s.id" :value="s.id">{{ s.id }} · {{ s.title }}</option>
        </optgroup>
      </select>
    </label>
    <div class="row">
      <label><input type="checkbox" :checked="pref.hideEmpty" @change="store.set(role, view, { hideEmpty: $event.target.checked })" /> скрывать пустые колонки</label>
      <input v-model="q" placeholder="Поиск колонки" style="flex: 1" />
    </div>
    <div class="row muted">
      Выбрано {{ list.filter(c => selected.has(c.id)).length }} из {{ list.length }}
      <button class="link" @click="only(list.map(c => c.id))">отметить найденные</button>
      <button class="link" @click="only([])">снять все</button>
      <button class="link" @click="store.reset(role, view)">по умолчанию</button>
    </div>
    <div class="list">
      <label v-for="c in list" :key="c.id" class="item">
        <input type="checkbox" :checked="selected.has(c.id)" @change="toggle(c.id)" />
        <b style="color: var(--accent); min-width: 2em">{{ c.code }}</b>
        <span>{{ c.title }}</span>
        <span class="muted">{{ c.writable ? (c.rights.includes('+') ? 'правка' : 'автор/нет') : 'чтение' }}</span>
      </label>
    </div>
    <p class="muted" style="margin: 0">Настройка хранится в браузере отдельно для каждой роли и списка. Отметка и статус видны всегда.</p>
  </AppModal>
</template>
