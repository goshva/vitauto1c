<script setup>
// Детали строки АРМ: документы, действия со строкой и заказом, все поля матрицы роли с правкой по нажатию.
// Правка — через родителя: save(column, value) — PATCH, pick(column) — выбор из справочника.
import { ref, computed, nextTick } from 'vue';
import AppModal from './AppModal.vue';
import AppIcon from './AppIcon.vue';
import { fieldInfo, valueOf, display, STATUS_TITLES, statusTone } from '../lib/columns';
import { ALWAYS } from '../stores/columns';

const props = defineProps({
  line: { type: Object, required: true },
  columns: { type: Array, required: true },
  deny: { type: Function, required: true },        // (column, line) -> причина запрета | null
  markDenied: { type: String, default: '' },
  editableFirst: { type: Boolean, default: true },
  hideEmpty: { type: Boolean, default: true },
  actions: { type: Array, default: () => [] },      // [{ key, title, icon, danger }]
  busy: Boolean
});
const emit = defineEmits(['close', 'save', 'pick', 'mark', 'action', 'document']);
const l = computed(() => props.line);
const title = computed(() => l.value.factName || (l.value.nomenclature && l.value.nomenclature.name) || 'Строка');
const DOCS = [['customerOrder', 'Заказ покупателя'], ['supplierOrder', 'Заказ поставщику'], ['receipt', 'Приходная'], ['shipmentDoc', 'Расходная']];
const docs = computed(() => DOCS.filter(([k]) => l.value[k]).map(([k, t]) => ({ ...l.value[k], label: t })));

const isEmpty = c => { const v = valueOf(l.value, c.field); return v === undefined || v === null || v === '' || v === 0 || v === false; };
const fields = computed(() => props.columns.filter(c => !ALWAYS.includes(c.id)).map(c => ({ c, why: props.deny(c, l.value), kind: fieldInfo(c.field).kind })));
const editable = computed(() => fields.value.filter(f => !f.why));
const readonly = computed(() => fields.value.filter(f => f.why));
const groups = computed(() => {
  if (!props.editableFirst) {
    const all = fields.value.filter(f => !(props.hideEmpty && f.why && isEmpty(f.c)));
    return [{ title: 'Поля', items: all }];
  }
  return [
    { title: 'Можно изменить', items: editable.value },
    { title: 'Только просмотр', items: readonly.value.filter(f => !(props.hideEmpty && isEmpty(f.c))) }
  ].filter(g => g.items.length);
});
// поля «только автору» открываются после отметки строки пользователем
const authorOnly = computed(() => !editable.value.length && readonly.value.some(f => /автор/.test(f.why)));
const hidden = computed(() => (props.hideEmpty ? readonly.value.filter(f => isEmpty(f.c)) : []));

// ---------- правка
const edit = ref(null); // { c, kind, value }
const input = ref(null);
async function tap(f) {
  if (f.why) return;
  if (f.kind === 'bool') return emit('save', f.c, !valueOf(l.value, f.c.field));
  if (f.kind === 'ref' || f.kind === 'nomenclature') return emit('pick', f.c);
  const v = valueOf(l.value, f.c.field);
  edit.value = { c: f.c, kind: f.kind, value: v == null ? '' : String(v), error: '' };
  await nextTick();
  const el = Array.isArray(input.value) ? input.value[0] : input.value;
  if (el) { el.focus(); el.select && el.select(); }
}
function commit() {
  const e = edit.value;
  if (!e) return;
  let value = e.value;
  if (e.kind === 'number') {
    if (String(value).trim() === '') value = 0;
    else {
      value = Number(String(value).replace(/\s/g, '').replace(',', '.'));
      if (Number.isNaN(value)) { e.error = 'Нужно число'; return; }
    }
  }
  if (e.kind === 'date') value = value || null;
  edit.value = null;
  if (String(valueOf(l.value, e.c.field) ?? '') !== String(value ?? '')) emit('save', e.c, value);
}
</script>

<template>
  <AppModal :title="title" side @close="emit('close')">
    <template #head>
      <span :class="['chip', statusTone(l.status)]">{{ STATUS_TITLES[l.status] || l.status }}</span>
    </template>

    <div class="ls-meta">
      <span v-if="l.customer">{{ l.customer.name }}</span>
      <span v-if="l.nomenclature && l.nomenclature.article" class="faint">арт. {{ l.nomenclature.article }}</span>
      <span class="faint">{{ l.operation === 'purchase' ? 'закупка' : 'продажа' }}</span>
    </div>
    <div v-if="docs.length" class="chips" aria-label="Документы">
      <button v-for="d in docs" :key="d.label" class="chip" @click="emit('document', d)">
        <AppIcon name="file" :size="15" />{{ d.label }} {{ d.number }}
        <span v-if="d.posted" class="ok">✓</span>
      </button>
    </div>

    <div class="ls-actions">
      <button :class="l.marked ? 'tonal' : ''" :disabled="!!markDenied || busy" :title="markDenied" @click="emit('mark', l)">
        <AppIcon :name="l.marked ? 'check' : 'pin'" :size="18" /> {{ l.marked ? 'Отмечена' : 'Отметить' }}
      </button>
      <button v-for="a in actions" :key="a.key" :class="{ danger: a.danger }" :disabled="busy" @click="emit('action', a.key)">
        <AppIcon :name="a.icon" :size="18" /> {{ a.title }}
      </button>
    </div>

    <div v-if="authorOnly" class="ls-hint">
      <AppIcon name="pin" :size="18" />
      <span>Поля этой строки меняет автор отметки. {{ markDenied ? markDenied + '.' : 'Отметьте строку — и их можно будет изменить.' }}</span>
    </div>

    <section v-for="g in groups" :key="g.title" class="ls-group">
      <div class="menu-title">{{ g.title }}</div>
      <div class="ls-list">
        <div v-for="f in g.items" :key="f.c.id" :class="['ls-field', { can: !f.why }]" :role="f.why ? null : 'button'" :tabindex="f.why ? null : 0"
             :title="f.why || 'Изменить'" :data-field="f.c.field" @click="tap(f)" @keydown.enter.self="tap(f)">
          <div class="ls-label"><span class="ls-code">{{ f.c.code }}</span>{{ f.c.title }}</div>
          <template v-if="edit && edit.c.id === f.c.id">
            <form class="ls-edit" @submit.prevent="commit" @click.stop>
              <input ref="input" v-model="edit.value" :type="edit.kind === 'date' ? 'date' : 'text'" :inputmode="edit.kind === 'number' ? 'decimal' : null"
                     :aria-label="f.c.title" @keydown.esc.stop="edit = null" />
              <button type="button" class="icon" aria-label="Отмена" @click="edit = null"><AppIcon name="x" :size="18" /></button>
              <button type="submit" class="icon on" aria-label="Сохранить"><AppIcon name="check" :size="18" /></button>
            </form>
            <div v-if="edit.error" class="err small">{{ edit.error }}</div>
          </template>
          <div v-else class="ls-value">
            <template v-if="f.kind === 'bool'">
              <span class="switch" @click.stop><input type="checkbox" :checked="!!valueOf(l, f.c.field)" :disabled="!!f.why" :aria-label="f.c.title" @change="emit('save', f.c, $event.target.checked)" /><span></span></span>
            </template>
            <template v-else>
              <span :class="{ faint: display(l, f.c.field) === '' }">{{ display(l, f.c.field) || (f.why ? '—' : 'не заполнено') }}</span>
              <AppIcon v-if="!f.why" :name="f.kind === 'ref' || f.kind === 'nomenclature' ? 'right' : 'edit'" :size="16" class="ls-go" />
              <AppIcon v-else name="lock" :size="14" class="ls-go faint" />
            </template>
          </div>
        </div>
      </div>
    </section>
    <details v-if="hidden.length" class="ls-hidden">
      <summary class="muted">Пустые поля только для чтения: {{ hidden.length }}</summary>
      <div class="faint small" style="padding: 8px 0">{{ hidden.map(f => f.c.title).join(', ') }}</div>
    </details>
    <template #actions><button @click="emit('close')">Закрыть</button></template>
  </AppModal>
</template>

<style scoped>
.ls-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--fg-2); margin-top: -6px; }
.ls-actions { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
.ls-actions button { flex: none; }
.ls-group .menu-title { padding-left: 2px; }
.ls-list { border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; background: var(--surface); }
.ls-field { padding: 10px 14px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; min-height: 52px; justify-content: center; }
.ls-field:last-child { border-bottom: 0; }
.ls-field.can { cursor: pointer; }
.ls-field.can:hover { background: var(--surface-2); }
.ls-label { font-size: 12px; color: var(--fg-3); }
.ls-code { color: var(--accent); font-weight: 700; margin-right: 6px; }
.ls-value { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: 15px; overflow-wrap: anywhere; }
.ls-go { color: var(--fg-3); }
.ls-edit { display: flex; gap: 4px; align-items: center; }
.ls-edit input { flex: 1; }
.ls-hint { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-m); background: var(--info-2); color: var(--fg); font-size: 13px; }
.ls-hidden summary { cursor: pointer; padding: 6px 0; }
</style>
