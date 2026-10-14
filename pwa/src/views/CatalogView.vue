<script setup>
// Разделы «Товары», «Услуги», «Машины»: список с поиском, карточка с правкой, создание, пометка на удаление.
// Операции /catalog/{goods|services|cars} — src/odata/backend.js (OData + команды АРМ_OData для цены и госномера).
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { get, api, post } from '../api';
import { useToastStore } from '../stores/toast';
import { useUiStore } from '../stores/ui';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';
import RefPicker from '../components/RefPicker.vue';

const route = useRoute();
const toast = useToastStore();
const ui = useUiStore();
const KINDS = {
  goods: { title: 'Товары', one: 'товар', icon: 'tag', search: 'Наименование или артикул' },
  services: { title: 'Услуги', one: 'услугу', icon: 'wrench', search: 'Наименование услуги' },
  cars: { title: 'Машины', one: 'машину', icon: 'car', search: 'Модель или VIN' }
};
const kind = computed(() => route.params.kind);
const K = computed(() => KINDS[kind.value]);
const isCars = computed(() => kind.value === 'cars');

const q = ref('');
const groupId = ref('');
const showDeleted = ref(false);
const items = ref([]);
const nextSkip = ref(null);
const canEdit = ref(false);
const loading = ref(false);
const groups = ref([]);
const units = ref([]);
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

async function load(more = false) {
  loading.value = true;
  try {
    const page = await get('/catalog/' + kind.value, { q: q.value.trim() || undefined, groupId: groupId.value || undefined,
      deleted: showDeleted.value ? 'true' : undefined, skip: more ? nextSkip.value : undefined, limit: 50 });
    items.value = more ? [...items.value, ...page.items] : page.items;
    nextSkip.value = page.nextSkip;
    canEdit.value = page.canEdit;
  } catch (e) {
    toast.error(e);
  } finally {
    loading.value = false;
  }
}
async function loadRefs() {
  try {
    if (isCars.value) groups.value = await get('/directories/car-groups');
    else if (!units.value.length) units.value = await get('/directories/units');
  } catch (e) { toast.error(e); }
}
// ---------- карточка (объявлена до watch(kind, …, { immediate: true }), который её сбрасывает)
const edit = ref(null);      // { id, form, item }
const picker = ref(false);   // выбор модели
const busy = ref(false);
watch(kind, () => { q.value = ''; groupId.value = ''; items.value = []; edit.value = null; load(); loadRefs(); }, { immediate: true });
let timer;
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
watch([groupId, showDeleted], () => load());

function formOf(it) {
  if (isCars.value) return { vin: it.vin || '', plate: it.plate || '', model: it.model, groupId: it.group ? it.group.id : (groupId.value || ''),
    year: it.year || '', chassis: it.chassis || '', engine: it.engine || '', comment: it.comment || '', name: it.name || '' };
  return { name: it.name || '', article: it.article || '', unitId: it.unit ? it.unit.id : (units.value.find(u => /^шт/.test(u.name)) || {}).id || '',
    price: it.price ?? '', comment: it.comment || '' };
}
function open(it) {
  edit.value = { id: it ? it.id : null, item: it || null, form: formOf(it || {}) };
  if (it && kind.value === 'services') {
    get(`/catalog/services/${it.id}`).then(full => { if (edit.value && edit.value.id === it.id) edit.value.item = full; }).catch(e => toast.error(e));
  }
}
function bodyOf(f) {
  if (isCars.value) return { vin: f.vin, plate: f.plate, modelId: f.model ? f.model.id : '', groupId: f.groupId, year: f.year || null,
    chassis: f.chassis, engine: f.engine, comment: f.comment, ...(edit.value.id ? { name: f.name } : {}) };
  return { name: f.name, article: f.article, unitId: f.unitId, comment: f.comment, price: f.price === '' ? undefined : f.price };
}
async function save() {
  busy.value = true;
  try {
    const e = edit.value;
    const saved = e.id ? (await api('PATCH', `/catalog/${kind.value}/${e.id}`, { body: bodyOf(e.form) })).data
      : await post(`/catalog/${kind.value}`, bodyOf(e.form));
    toast.show(`${e.id ? 'Сохранено' : 'Создано'}: ${saved.name}`, 'ok');
    const i = items.value.findIndex(x => x.id === saved.id);
    if (i >= 0) items.value.splice(i, 1, saved); else items.value.unshift(saved);
    edit.value = null;
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = false;
  }
}
async function remove(restore) {
  const e = edit.value;
  if (!restore && !confirm(`Пометить на удаление «${e.item.name}»?`)) return;
  busy.value = true;
  try {
    const saved = restore ? await post(`/catalog/${kind.value}/${e.id}/restore`) : (await api('DELETE', `/catalog/${kind.value}/${e.id}`)).data;
    toast.show(restore ? 'Пометка снята' : 'Помечено на удаление', 'ok');
    if (!restore && !showDeleted.value) items.value = items.value.filter(x => x.id !== e.id);
    else items.value.splice(items.value.findIndex(x => x.id === e.id), 1, saved);
    edit.value = null;
  } catch (err) { toast.error(err); } finally { busy.value = false; }
}
const layout = computed(() => ui.effectiveLayout);
// цены авторабот, сгруппированные по цене: { price, models[] }
function priceGroups(list) {
  const by = new Map();
  for (const x of list) {
    if (!by.has(x.price)) by.set(x.price, []);
    by.get(x.price).push(x.model ? x.model.name : 'все модели');
  }
  return [...by].map(([price, models]) => ({ price, models }));
}
</script>

<template>
  <section class="page catalog" style="max-width: none">
    <Teleport to="#appbar-actions" defer>
      <button class="icon" :class="{ on: showDeleted }" :aria-label="showDeleted ? 'Скрыть удалённые' : 'Показать удалённые'"
              :title="showDeleted ? 'Скрыть помеченные на удаление' : 'Показать помеченные на удаление'" @click="showDeleted = !showDeleted"><AppIcon name="trash" /></button>
      <button class="icon" aria-label="Обновить" title="Обновить" :disabled="loading" @click="load()"><AppIcon name="refresh" /></button>
    </Teleport>

    <div class="cat-head">
      <div class="search"><span class="ico"><AppIcon name="search" :size="18" /></span>
        <input v-model="q" type="search" :placeholder="K.search" :aria-label="'Поиск: ' + K.title" /></div>
      <div v-if="isCars && groups.length" class="chips" role="group" aria-label="Вид техники">
        <button class="chip" :class="{ on: !groupId }" @click="groupId = ''">Все</button>
        <button v-for="g in groups" :key="g.id" class="chip" :class="{ on: groupId === g.id }" @click="groupId = g.id">{{ g.name }}</button>
      </div>
      <div class="muted small">{{ loading ? 'Загрузка…' : `Показано: ${items.length}${nextSkip ? '+' : ''}` }}<template v-if="!canEdit"> · только просмотр</template></div>
    </div>

    <!-- таблица (широкий экран) -->
    <div v-if="layout === 'table'" class="table-wrap">
      <table>
        <thead>
          <tr v-if="isCars"><th>Госномер</th><th>Модель</th><th>VIN</th><th>Год</th><th>Вид техники</th><th>Комментарий</th></tr>
          <tr v-else><th>Наименование</th><th v-if="kind === 'goods'">Артикул</th><th>Ед.</th><th style="text-align: right">Цена</th><th>Комментарий</th><th>Код</th></tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id" :class="['cat-row', { deleted: it.deleted }]" tabindex="0" @click="open(it)" @keydown.enter="open(it)">
            <template v-if="isCars">
              <td><b>{{ it.plate || '—' }}</b></td><td>{{ it.model ? it.model.name : '' }}</td><td class="mono">{{ it.vin }}</td>
              <td>{{ it.year || '' }}</td><td>{{ it.group ? it.group.name : '' }}</td><td>{{ it.comment }}</td>
            </template>
            <template v-else>
              <td>{{ it.name }}</td><td v-if="kind === 'goods'" class="mono">{{ it.article }}</td><td>{{ it.unit ? it.unit.name : '' }}</td>
              <td class="num">{{ it.price != null ? money.format(it.price) : '—' }}</td><td>{{ it.comment }}</td><td class="faint">{{ it.code }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- карточки (телефон) -->
    <div v-else class="cat-cards">
      <article v-for="it in items" :key="it.id" :class="['card', 'cat-card', { deleted: it.deleted }]" tabindex="0" @click="open(it)" @keydown.enter="open(it)">
        <template v-if="isCars">
          <div class="row" style="justify-content: space-between; flex-wrap: nowrap">
            <b class="plate">{{ it.plate || 'без номера' }}</b><span class="faint small">{{ it.year || '' }}</span>
          </div>
          <div>{{ it.model ? it.model.name : it.name }}</div>
          <div class="faint small mono">VIN {{ it.vin }}</div>
          <div v-if="it.group" class="muted small">{{ it.group.name }}</div>
        </template>
        <template v-else>
          <div class="row" style="justify-content: space-between; flex-wrap: nowrap; align-items: flex-start">
            <b class="grow">{{ it.name }}</b>
            <span class="chip info">{{ it.price != null ? money.format(it.price) + ' ₽' : 'нет цены' }}</span>
          </div>
          <div class="muted small"><span v-if="it.article">арт. {{ it.article }} · </span>{{ it.unit ? it.unit.name : '' }}<span v-if="it.comment"> · {{ it.comment }}</span></div>
        </template>
        <span v-if="it.deleted" class="chip err" style="align-self: flex-start">помечен на удаление</span>
      </article>
    </div>

    <div v-if="!items.length && !loading" class="empty"><div class="big"><AppIcon :name="K.icon" :size="40" /></div>{{ q ? 'Ничего не найдено' : 'Пусто' }}</div>
    <div v-if="nextSkip" class="row" style="justify-content: center; padding: 12px"><button :disabled="loading" @click="load(true)">Загрузить ещё</button></div>

    <button v-if="canEdit" class="fab primary" :aria-label="'Добавить ' + K.one" :title="'Добавить ' + K.one" @click="open(null)">
      <AppIcon name="plus" :size="24" /><span class="fab-label">{{ K.one[0].toUpperCase() + K.one.slice(1) }}</span>
    </button>

    <!-- карточка -->
    <AppModal v-if="edit" :title="edit.id ? edit.item.name : 'Новый: ' + K.one" side @close="edit = null">
      <form class="col" @submit.prevent="save">
        <fieldset :disabled="!canEdit || busy" class="col" style="border: 0; padding: 0; margin: 0">
          <template v-if="isCars">
            <label class="field">Госномер <input v-model="edit.form.plate" autocapitalize="characters" /></label>
            <label class="field">VIN <input v-model="edit.form.vin" required autocapitalize="characters" class="mono" /></label>
            <label class="field">Модель <button type="button" @click="picker = true">{{ edit.form.model ? edit.form.model.name : 'Выбрать…' }} <AppIcon name="right" :size="18" /></button></label>
            <label class="field">Вид техники
              <select v-model="edit.form.groupId"><option value="">—</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select>
            </label>
            <div class="row" style="flex-wrap: nowrap">
              <label class="field grow">Год выпуска <input v-model="edit.form.year" inputmode="numeric" /></label>
              <label class="field grow">№ шасси <input v-model="edit.form.chassis" /></label>
            </div>
            <label class="field">№ двигателя <input v-model="edit.form.engine" /></label>
            <label v-if="edit.id" class="field">Наименование в 1С <input v-model="edit.form.name" /></label>
          </template>
          <template v-else>
            <label class="field">Наименование <input v-model="edit.form.name" required /></label>
            <label v-if="kind === 'goods'" class="field">Артикул <input v-model="edit.form.article" /></label>
            <div class="row" style="flex-wrap: nowrap">
              <label class="field grow">Единица
                <select v-model="edit.form.unitId"><option value="">—</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.name }}</option></select>
              </label>
              <label class="field grow">Цена, ₽ (розничная) <input v-model="edit.form.price" inputmode="decimal" /></label>
            </div>
            <p v-if="edit.item && edit.item.priceDate" class="faint small" style="margin: -4px 0 0">Цена установлена {{ edit.item.priceDate.split('-').reverse().join('.') }}<template v-if="kind === 'services'"> — для моделей без своей цены</template></p>
          </template>
          <label class="field">Комментарий <textarea v-model="edit.form.comment" rows="2" style="font-family: var(--font); font-size: 15px"></textarea></label>
        </fieldset>
        <section v-if="kind === 'services' && edit.item && edit.item.modelPrices && edit.item.modelPrices.length" class="col" style="gap: 6px">
          <div class="menu-title" style="padding-left: 0">Цены по моделям (цены авторабот)</div>
          <details v-for="g in priceGroups(edit.item.modelPrices)" :key="g.price" class="mp-group">
            <summary><b>{{ money.format(g.price) }} ₽</b> <span class="muted small">— моделей: {{ g.models.length }}</span></summary>
            <div class="faint small mp-list">{{ g.models.join(' · ') }}</div>
          </details>
          <p class="faint small" style="margin: 0">Меняются документом «Установка цен авторабот» в 1С (или повторной загрузкой «Услуга.xlsx»).</p>
        </section>
        <p v-if="edit.item" class="faint small" style="margin: 0">Код {{ edit.item.code }}</p>
      </form>
      <template #actions>
        <button v-if="edit.id && canEdit && !edit.item.deleted" class="danger" :disabled="busy" @click="remove(false)"><AppIcon name="trash" :size="18" /> Удалить</button>
        <button v-if="edit.id && canEdit && edit.item.deleted" :disabled="busy" @click="remove(true)"><AppIcon name="undo" :size="18" /> Восстановить</button>
        <button @click="edit = null">{{ canEdit ? 'Отмена' : 'Закрыть' }}</button>
        <button v-if="canEdit" class="primary" :disabled="busy" @click="save">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button>
      </template>
    </AppModal>
    <RefPicker v-if="picker" dir="car-models" title="Модель" @pick="m => { edit.form.model = m; picker = false }" @close="picker = false" />
  </section>
</template>

<style scoped>
.cat-head { display: flex; flex-direction: column; gap: 8px; }
@media (min-width: 900px) { .cat-head .search { max-width: 480px; } }
.cat-cards { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); }
.cat-card { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; cursor: pointer; }
.cat-card:hover, .cat-row:hover td { border-color: var(--accent); background: color-mix(in srgb, var(--accent-2) 40%, var(--surface)); }
.cat-row { cursor: pointer; }
.deleted { opacity: .55; }
.plate { font-size: 17px; letter-spacing: .03em; }
.mono { font-family: var(--mono); font-size: 12px; }
.mp-group { border: 1px solid var(--line); border-radius: var(--r-s); padding: 8px 12px; background: var(--surface-2); }
.mp-group summary { cursor: pointer; }
.mp-list { padding-top: 6px; line-height: 1.6; }
.fab { position: fixed; right: 16px; bottom: calc(var(--nav-h) + var(--safe-b) + 16px); z-index: 35; height: 56px; min-width: 56px; border-radius: 18px; padding: 0 18px; box-shadow: var(--shadow-2); }
.fab-label { display: none; }
@media (min-width: 900px) { .fab { bottom: 24px; right: 24px; } .fab-label { display: inline; } }
</style>
