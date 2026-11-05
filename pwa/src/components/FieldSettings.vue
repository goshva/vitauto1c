<script setup>
// Отображаемые поля списка строк для текущей роли и списка: карточка (телефон), таблица (ПК), детали строки, вид.
import { ref, computed } from 'vue';
import AppModal from './AppModal.vue';
import AppIcon from './AppIcon.vue';
import { useColumnsStore, STAGES, ALWAYS, CARD_TITLE, CARD_MAX } from '../stores/columns';
import { useUiStore } from '../stores/ui';
import { display } from '../lib/columns';

const props = defineProps({
  role: { type: String, required: true },
  view: { type: String, required: true },
  columns: { type: Array, required: true },
  sample: { type: Object, default: null },   // строка для предпросмотра карточки
  tab: { type: String, default: 'card' }
});
const emit = defineEmits(['close']);
const store = useColumnsStore();
const ui = useUiStore();
const tab = ref(props.tab);
const q = ref('');
const VIEW_TITLES = { sales: 'продажи', purchases: 'закупки', supply: 'снабжение' };
const TABS = [['card', 'Карточка'], ['table', 'Таблица'], ['details', 'Детали'], ['look', 'Вид']];

const pref = computed(() => store.pref(props.role, props.view));
const match = c => { const s = q.value.trim().toLowerCase(); return !s || (c.code + ' ' + c.title + ' ' + c.field).toLowerCase().includes(s); };
const rightsOf = c => (c.writable ? (c.rights.includes('+') ? 'правка' : c.rights.includes('c') ? 'автор' : 'чтение') : 'чтение');
const stagesByRole = computed(() => {
  const out = {};
  for (const st of STAGES) (out[st.roleTitle] = out[st.roleTitle] || []).push(st);
  return out;
});

// ---------- карточка
const cardCols = computed(() => store.cardColumns(props.role, props.view, props.columns));
const cardSet = computed(() => new Set(cardCols.value.map(c => c.id)));
const candidates = computed(() => props.columns.filter(c => !ALWAYS.includes(c.id) && !CARD_TITLE.includes(c.id) && !cardSet.value.has(c.id)).filter(match));
const cardStage = e => {
  const st = STAGES.find(s => s.id === e.target.value);
  if (st) store.setCard(props.role, props.view, st.columns.filter(id => !ALWAYS.includes(id) && !CARD_TITLE.includes(id)));
  e.target.value = '';
};
const resetCard = () => store.set(props.role, props.view, { cardIds: null });

// ---------- таблица
const selected = computed(() => new Set(store.selectedIds(props.role, props.view, props.columns)));
const tableList = computed(() => props.columns.filter(c => !ALWAYS.includes(c.id)).filter(match));
function mode(m) { store.set(props.role, props.view, { mode: m }); }
function stage(e) { store.set(props.role, props.view, { mode: e.target.value ? 'stage' : 'compact', stage: e.target.value || null }); }
function toggle(id) { store.toggle(props.role, props.view, props.columns, id); }
function only(ids) { store.set(props.role, props.view, { mode: 'custom', ids }); }
</script>

<template>
  <AppModal :title="`Поля: ${VIEW_TITLES[view] || view}`" wide @close="emit('close')">
    <div class="segmented" role="tablist" style="align-self: flex-start; max-width: 100%; overflow-x: auto">
      <button v-for="[k, t] in TABS" :key="k" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" @click="tab = k">{{ t }}</button>
    </div>

    <!-- карточка -->
    <template v-if="tab === 'card'">
      <p class="muted small" style="margin: 0">Поля под наименованием в карточке строки — в этом порядке (до {{ CARD_MAX }}). Наименование, артикул, статус и отметка видны всегда.</p>
      <div v-if="sample" class="card fs-preview" aria-label="Предпросмотр">
        <div class="small faint">Предпросмотр</div>
        <b>{{ sample.factName || (sample.nomenclature && sample.nomenclature.name) || 'Наименование' }}</b>
        <div class="fs-kv">
          <template v-for="c in cardCols" :key="c.id"><span class="faint">{{ c.title }}</span><span>{{ display(sample, c.field) || '—' }}</span></template>
        </div>
      </div>
      <div class="list fs-card" style="max-height: none">
        <div v-for="(c, i) in cardCols" :key="c.id" class="item">
          <b class="fs-code">{{ c.code }}</b><span class="grow">{{ c.title }}</span>
          <button class="icon" :disabled="i === 0" :aria-label="'Выше: ' + c.title" @click="store.moveCard(role, view, c.id, -1)"><AppIcon name="up" :size="18" /></button>
          <button class="icon" :disabled="i === cardCols.length - 1" :aria-label="'Ниже: ' + c.title" @click="store.moveCard(role, view, c.id, 1)"><AppIcon name="down" :size="18" /></button>
          <button class="icon" :aria-label="'Убрать: ' + c.title" @click="store.toggleCard(role, view, c.id)"><AppIcon name="x" :size="18" /></button>
        </div>
        <div v-if="!cardCols.length" class="item muted">Только наименование и статус</div>
      </div>
      <div class="row">
        <select style="flex: 1 1 220px" @change="cardStage" aria-label="Набор этапа процесса">
          <option value="">Набор этапа процесса…</option>
          <optgroup v-for="(items, r) in stagesByRole" :key="r" :label="r">
            <option v-for="s in items" :key="s.id" :value="s.id">{{ s.id }} · {{ s.title }}</option>
          </optgroup>
        </select>
        <button class="ghost" @click="resetCard">По умолчанию</button>
      </div>
      <div class="search"><span class="ico"><AppIcon name="search" :size="18" /></span><input v-model="q" placeholder="Добавить поле: поиск" /></div>
      <div class="list">
        <button v-for="c in candidates" :key="c.id" class="item fs-add" :disabled="cardCols.length >= CARD_MAX" @click="store.toggleCard(role, view, c.id)">
          <AppIcon name="plus" :size="18" /><b class="fs-code">{{ c.code }}</b><span class="grow">{{ c.title }}</span><span class="faint small">{{ rightsOf(c) }}</span>
        </button>
      </div>
    </template>

    <!-- таблица -->
    <template v-else-if="tab === 'table'">
      <div class="row">
        <button :class="{ primary: pref.mode === 'compact' }" @click="mode('compact')">Основные</button>
        <button :class="{ primary: pref.mode === 'mine' }" @click="mode('mine')">Редактируемые ролью</button>
        <button :class="{ primary: pref.mode === 'all' }" @click="mode('all')">Все</button>
        <span v-if="pref.mode === 'custom'" class="chip info">свой набор</span>
      </div>
      <label class="field">Этап процесса (process.html)
        <select :value="pref.mode === 'stage' ? pref.stage : ''" @change="stage">
          <option value="">— не выбран —</option>
          <optgroup v-for="(items, r) in stagesByRole" :key="r" :label="r">
            <option v-for="s in items" :key="s.id" :value="s.id">{{ s.id }} · {{ s.title }}</option>
          </optgroup>
        </select>
      </label>
      <label class="row" style="justify-content: space-between">Скрывать пустые колонки
        <span class="switch"><input type="checkbox" :checked="pref.hideEmpty" @change="store.set(role, view, { hideEmpty: $event.target.checked })" /><span></span></span>
      </label>
      <div class="search"><span class="ico"><AppIcon name="search" :size="18" /></span><input v-model="q" placeholder="Поиск колонки" /></div>
      <div class="row muted small">
        Выбрано {{ tableList.filter(c => selected.has(c.id)).length }} из {{ tableList.length }}
        <button class="link" @click="only(tableList.map(c => c.id))">отметить найденные</button>
        <button class="link" @click="only([])">снять все</button>
        <button class="link" @click="store.reset(role, view)">по умолчанию</button>
      </div>
      <div class="list">
        <label v-for="c in tableList" :key="c.id" class="item">
          <input type="checkbox" :checked="selected.has(c.id)" @change="toggle(c.id)" />
          <b class="fs-code">{{ c.code }}</b>
          <span class="grow">{{ c.title }}</span>
          <span class="faint small">{{ rightsOf(c) }}</span>
        </label>
      </div>
    </template>

    <!-- детали строки -->
    <template v-else-if="tab === 'details'">
      <p class="muted small" style="margin: 0">Карточка строки (по нажатию) показывает все поля матрицы роли.</p>
      <label class="row" style="justify-content: space-between">Сначала поля, которые можно изменить
        <span class="switch"><input type="checkbox" :checked="pref.detailEditableFirst" @change="store.set(role, view, { detailEditableFirst: $event.target.checked })" /><span></span></span>
      </label>
      <label class="row" style="justify-content: space-between">Сворачивать пустые поля только для чтения
        <span class="switch"><input type="checkbox" :checked="pref.detailHideEmpty" @change="store.set(role, view, { detailHideEmpty: $event.target.checked })" /><span></span></span>
      </label>
    </template>

    <!-- вид -->
    <template v-else>
      <div class="menu-title" style="padding-left: 0">Список строк</div>
      <div class="segmented">
        <button :class="{ on: ui.layout === 'auto' }" @click="ui.setLayout('auto')">Авто</button>
        <button :class="{ on: ui.layout === 'cards' }" @click="ui.setLayout('cards')">Карточки</button>
        <button :class="{ on: ui.layout === 'table' }" @click="ui.setLayout('table')">Таблица</button>
      </div>
      <p class="muted small" style="margin: 0">Авто — карточки на телефоне, таблица на широком экране.</p>
      <div class="menu-title" style="padding-left: 0">Плотность</div>
      <div class="segmented">
        <button :class="{ on: ui.density === 'comfortable' }" @click="ui.setDensity('comfortable')">Обычная</button>
        <button :class="{ on: ui.density === 'compact' }" @click="ui.setDensity('compact')">Компактная</button>
      </div>
    </template>

    <template #actions>
      <span class="faint small" style="align-self: center; flex: 1">Хранится в браузере — отдельно для роли и списка</span>
      <button class="primary" @click="emit('close')">Готово</button>
    </template>
  </AppModal>
</template>

<style scoped>
.fs-code { color: var(--accent); min-width: 2.2em; font-size: 13px; }
.fs-card .item { cursor: default; padding-right: 4px; }
.fs-card .item:hover { background: none; }
.fs-add { text-align: left; width: 100%; border: 0; border-radius: 0; border-bottom: 1px solid var(--line); background: none; font-weight: 500; justify-content: flex-start; min-height: 48px; }
.fs-preview { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: var(--surface-2); box-shadow: none; }
.fs-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 13px; }
</style>
