<script setup>
// Карточка строки АРМ в списке (телефон): отметка, наименование, статус, выбранные поля (настройка «Карточка»).
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { display, STATUS_TITLES, statusTone } from '../lib/columns';

const props = defineProps({
  line: { type: Object, required: true },
  fields: { type: Array, default: () => [] },
  current: Boolean,
  markDenied: { type: String, default: '' }   // почему нельзя отметить — или ''
});
const emit = defineEmits(['open', 'mark']);
const l = computed(() => props.line);
const title = computed(() => l.value.factName || (l.value.nomenclature && l.value.nomenclature.name) || 'Без наименования');
const sub = computed(() => {
  const n = l.value.nomenclature;
  const parts = [];
  if (n && n.name && l.value.factName && n.name !== l.value.factName) parts.push(n.name);
  const art = (n && n.article) || l.value.factArticle;
  if (art) parts.push(art);
  return parts.join(' · ');
});
// пустые и нулевые значения в карточке не показываем — они есть в деталях строки
const kv = computed(() => props.fields.map(c => ({ c, v: display(l.value, c.field) })).filter(x => x.v !== '' && x.v !== '0'));
</script>

<template>
  <article :class="['line-card', { marked: l.marked, current, deleted: l.deleted, locked: l.locked }]" @click="emit('open', l)">
    <label class="lc-mark" @click.stop :title="markDenied || (l.markedBy ? 'Отметил: ' + l.markedBy : 'Отметить')">
      <input type="checkbox" :checked="l.marked" :disabled="!!markDenied" :aria-label="'Отметить: ' + title" @click.prevent="emit('mark', l)" />
    </label>
    <div class="lc-body">
      <div class="lc-head">
        <div class="lc-title">{{ title }}</div>
        <span :class="['chip', statusTone(l.status)]">{{ STATUS_TITLES[l.status] || l.status }}</span>
      </div>
      <div v-if="sub" class="lc-sub">{{ sub }}</div>
      <dl v-if="kv.length" class="lc-kv">
        <template v-for="x in kv" :key="x.c.id"><dt>{{ x.c.title }}</dt><dd>{{ x.v }}</dd></template>
      </dl>
      <div v-if="l.markedBy || l.locked" class="lc-foot">
        <span v-if="l.locked" class="chip err"><AppIcon name="lock" :size="13" /> фоновое задание</span>
        <span v-if="l.markedBy" class="faint small">отметил {{ l.markedBy }}</span>
      </div>
    </div>
    <AppIcon name="right" :size="18" class="lc-go" />
  </article>
</template>

<style scoped>
.line-card {
  display: flex; gap: 4px; align-items: flex-start; padding: 10px 8px 10px 0; background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--r-m); box-shadow: var(--shadow-1); cursor: pointer;
  transition: border-color .12s, background .12s;
}
.line-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.line-card.marked { background: var(--marked); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
.line-card.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.line-card.deleted { opacity: .55; }
.line-card.deleted .lc-title { text-decoration: line-through; }
.lc-mark { width: 48px; min-height: 44px; display: flex; justify-content: center; align-items: flex-start; padding-top: 2px; flex: none; cursor: pointer; }
.lc-mark input { width: 22px; height: 22px; }
.lc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.lc-head { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
.lc-title { font-weight: 650; font-size: 15px; line-height: 1.3; overflow-wrap: anywhere; }
.lc-sub { color: var(--fg-2); font-size: 13px; overflow-wrap: anywhere; }
.lc-kv { display: grid; grid-template-columns: minmax(84px, max-content) 1fr; gap: 3px 12px; margin: 4px 0 0; font-size: 13px; }
.lc-kv dt { color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
.lc-kv dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lc-foot { display: flex; gap: 8px; align-items: center; margin-top: 2px; flex-wrap: wrap; }
.lc-go { color: var(--fg-3); margin-top: 2px; }
:global(.dense) .line-card { padding-top: 6px; padding-bottom: 6px; }
:global(.dense) .lc-kv { gap: 1px 10px; font-size: 12px; margin-top: 2px; }
</style>
