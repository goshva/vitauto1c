<script setup>
// Список строк АРМ (продажи / закупки / снабжение). Телефон — карточки и лист деталей, ПК — таблица с правкой в ячейке.
// Поля — настройка «Поля» (stores/columns.js), права на правку — матрица роли (stores/matrix.js).
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useMatrixStore } from '../stores/matrix';
import { useLinesStore } from '../stores/lines';
import { useToastStore } from '../stores/toast';
import { useUiStore } from '../stores/ui';
import { api, post } from '../api';
import { fieldInfo, valueOf, display, STATUS_TITLES, statusTone } from '../lib/columns';
import { useColumnsStore, STAGES } from '../stores/columns';
import RefPicker from '../components/RefPicker.vue';
import FieldSettings from '../components/FieldSettings.vue';
import AppModal from '../components/AppModal.vue';
import AppIcon from '../components/AppIcon.vue';
import JobDialog from '../components/JobDialog.vue';
import LineCard from '../components/LineCard.vue';
import LineSheet from '../components/LineSheet.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const matrix = useMatrixStore();
const lines = useLinesStore();
const toast = useToastStore();
const ui = useUiStore();
const columnsPref = useColumnsStore();

const view = computed(() => route.params.view);
const userName = computed(() => session.user && session.user.userName);
const layout = computed(() => ui.effectiveLayout);
const pref = computed(() => columnsPref.pref(session.role, view.value));

// ---------- поля
const settings = ref(null); // вкладка настройки полей или null
const isEmpty = (line, c) => {
  const v = valueOf(line, c.field);
  return v === undefined || v === null || v === '' || v === 0 || v === false;
};
const visibleColumns = computed(() => columnsPref.visible(session.role, view.value, matrix.columns, lines.items, isEmpty));
const cardFields = computed(() => columnsPref.cardColumns(session.role, view.value, matrix.columns));
const columnsMode = computed(() => {
  const p = pref.value;
  if (p.mode === 'stage') {
    const st = STAGES.find(s => s.id === p.stage);
    return st ? `этап ${st.id}` : '';
  }
  return { compact: 'основные', all: 'все', mine: 'редактируемые', custom: 'свой набор' }[p.mode] + (p.hideEmpty ? ', без пустых' : '');
});

// ---------- загрузка
async function reload() {
  try {
    if (matrix.role !== session.role || !matrix.columns.length) await matrix.load(session.role);
    lines.view = view.value;
    await lines.load();
  } catch (e) {
    toast.error(e);
  }
}
// ---------- поиск (по загруженным строкам) и группировка по заказам
const q = ref('');
watch(view, () => { q.value = ''; reload(); }, { immediate: true });

const searchText = l => [l.factName, l.factArticle, l.nomenclature && l.nomenclature.name, l.nomenclature && l.nomenclature.article,
  l.customerOrder && l.customerOrder.number, l.clientOrderNumber, l.customer && l.customer.name, l.supplier && l.supplier.name, l.comment]
  .filter(Boolean).join(' ').toLowerCase();
const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? lines.items.filter(l => searchText(l).includes(s)) : lines.items;
});
const rows = computed(() => {
  if (!lines.filters.groupByCustomerOrder) return shown.value.map(l => ({ line: l }));
  const out = [];
  const stat = {};
  for (const l of shown.value) {
    const k = l.customerOrder ? l.customerOrder.id : '';
    const s = stat[k] = stat[k] || { count: 0, marked: 0, saleSum: 0, statuses: {} };
    s.count++;
    if (l.marked) s.marked++;
    s.saleSum += Number(l.saleSum) || 0;
    s.statuses[l.status] = (s.statuses[l.status] || 0) + 1;
  }
  let key;
  for (const l of shown.value) {
    const k = l.customerOrder ? l.customerOrder.id : '';
    if (k !== key) {
      key = k;
      out.push({ group: l.customerOrder, customer: l.customer, ...stat[k], key: 'g' + k });
    }
    out.push({ line: l, groupKey: 'g' + k });
  }
  return out;
});

// ---------- заказы-аккордеон (таблица): свёрнуты по умолчанию; поиск и отбор по заказу раскрывают
const expanded = ref(new Set());
const autoOpen = computed(() => !!q.value.trim() || !!lines.filters.customerOrderId);
const isOpen = key => autoOpen.value || expanded.value.has(key);
function toggleGroup(key) {
  const s = new Set(expanded.value);
  s.has(key) ? s.delete(key) : s.add(key);
  expanded.value = s;
}
const groupKeys = computed(() => rows.value.filter(r => !r.line).map(r => r.key));
const allOpen = computed(() => groupKeys.value.length > 0 && groupKeys.value.every(isOpen));
function toggleAll() {
  expanded.value = allOpen.value ? new Set() : new Set(groupKeys.value);
}
const tableRows = computed(() => rows.value.filter(r => !r.line || !r.groupKey || isOpen(r.groupKey)));

// ---------- фильтры
const filtersOpen = ref(false);
const activeFilters = computed(() => {
  const f = lines.filters;
  return [f.periodFrom, f.periodTo, f.hideShipped, !f.hideDeleted, f.onlyWithPurchases].filter(Boolean).length;
});
function toggleFilter(k) {
  lines.filters[k] = !lines.filters[k];
  reload();
}
function applyFilters() {
  filtersOpen.value = false;
  reload();
}
function onlyOrder(group) {
  lines.filters.customerOrderId = group.id;
  orderMenu.value = null;
  reload();
}
function clearOrder() {
  lines.filters.customerOrderId = '';
  reload();
}

// ---------- права и правка
function deny(line, column) {
  return matrix.denyReason(column, line, userName.value);
}
const markDenied = line => (line.locked ? 'строка заблокирована фоном' : line.markedBy && line.markedBy !== userName.value ? 'отмечена: ' + line.markedBy : '');

// правка в ячейке таблицы
const editing = ref(null); // { line, column, value, kind }
const picker = ref(null); // { line, column, dir, query }
const editInput = ref(null);
async function startEdit(line, column) {
  lines.current = line.id;
  if (deny(line, column)) return;
  const info = fieldInfo(column.field);
  if (info.kind === 'bool') return save(line, column, !valueOf(line, column.field));
  if (info.kind === 'ref' || info.kind === 'nomenclature') return openPicker(line, column);
  const v = valueOf(line, column.field);
  editing.value = { line, column, value: v == null ? '' : String(v), kind: info.kind };
  await nextTick();
  const el = editInput.value && (Array.isArray(editInput.value) ? editInput.value[0] : editInput.value);
  if (el) { el.focus(); el.select && el.select(); }
}
function openPicker(line, column) {
  const info = fieldInfo(column.field);
  picker.value = { line, column, dir: info.dir, query: info.query ? info.query(line) : {} };
}
function parse(kind, raw) {
  if (kind === 'number') {
    if (String(raw).trim() === '') return 0;
    const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(n)) throw new Error('Нужно число');
    return n;
  }
  if (kind === 'date') return raw || null;
  return raw;
}
async function commitEdit() {
  const e = editing.value;
  if (!e) return;
  editing.value = null;
  let value;
  try { value = parse(e.kind, e.value); } catch (err) { toast.error(err); return; }
  const old = valueOf(e.line, e.column.field);
  if (String(old ?? '') === String(value ?? '')) return;
  await save(e.line, e.column, value);
}
async function save(line, column, value) {
  try {
    await lines.patch(line, column.field, value);
    if (sheetId.value === line.id) toast.show(`${column.title}: сохранено`, 'ok', 1800);
  } catch (e) {
    toast.error(e);
  }
}
async function picked(item) {
  const p = picker.value;
  picker.value = null;
  if (item === undefined) return;
  await save(p.line, p.column, item ? item.id : null);
}

// ---------- лист деталей строки
const sheetId = ref(null);
const sheetLine = computed(() => lines.items.find(l => l.id === sheetId.value) || null);
function openLine(line) {
  lines.current = line.id;
  sheetId.value = line.id;
}
const sheetActions = computed(() => {
  const l = sheetLine.value;
  if (!l || view.value === 'supply') return [];
  const a = [];
  if (view.value === 'sales' && l.customerOrder) a.push({ key: 'add', title: 'Строки в заказ', icon: 'plus' });
  a.push({ key: 'purchase', title: 'Закупка к строке', icon: 'purchases' });
  if (view.value === 'sales' && l.customerOrder) {
    a.push({ key: 'shipment', title: 'Отгрузка', icon: 'supply' });
    a.push({ key: 'post', title: 'Провести заказ', icon: 'send' });
  }
  a.push({ key: 'strike', title: 'Вычеркнуть', icon: 'trash', danger: true });
  if (view.value === 'sales' && l.customerOrder) a.push({ key: 'deleteOrder', title: 'Удалить заказ', icon: 'trash', danger: true });
  return a;
});
function sheetAction(key) {
  ({ add: openAdd, purchase: openAddPurchase, shipment: openShipment, post: postOrder, strike: strikeLine, deleteOrder })[key]();
}

// ---------- отметки
async function toggleMark(line) {
  lines.current = line.id;
  try { await lines.toggleMark(line); } catch (e) { toast.error(e); }
}
const orderMenu = ref(null); // группа заказа для меню
async function markOrder(order, marked) {
  orderMenu.value = null;
  try {
    const r = await lines.markOrder(order.id, marked);
    toast.show(`${marked ? 'Отмечено' : 'Снято'}: ${r.processed} из ${r.total}`, 'ok');
  } catch (e) { toast.error(e); }
}
async function clearMyMarks() {
  actionsOpen.value = false;
  await run(async () => {
    for (const l of lines.items.filter(x => x.marked && x.markedBy === userName.value)) await lines.toggleMark(l);
  }, 'Отметки сняты');
}

// ---------- команды
const current = computed(() => lines.currentLine);
const currentOrder = computed(() => current.value && current.value.customerOrder);
const busy = ref(false);
async function run(fn, okText) {
  busy.value = true;
  try {
    const r = await fn();
    if (okText) toast.show(typeof okText === 'function' ? okText(r) : okText, 'ok');
    await lines.load();
    return r;
  } catch (e) {
    toast.error(e);
  } finally {
    busy.value = false;
  }
}
const result = r => (r && r.processed !== undefined ? `Обработано ${r.processed} из ${r.total}${r.message ? ': ' + r.message : ''}` : 'Готово');

// «В работе» — задание
const allowSplit = ref(false);
const job = ref(null);
async function startJob(split = allowSplit.value) {
  actionsOpen.value = false;
  busy.value = true;
  try {
    job.value = await post('/sales/jobs', { allowSplit: split });
  } catch (e) { toast.error(e); } finally { busy.value = false; }
}
function jobClosed() {
  job.value = null;
  lines.load().catch(e => toast.error(e));
}

const closeSheets = () => { actionsOpen.value = false; };
const prepared = () => { closeSheets(); return run(() => post('/sales/prepared'), result); };
const supplierOrder = () => { closeSheets(); return run(() => post('/sales/supplier-orders', {}), result); };
const postOrder = () => run(() => post(`/sales/customer-orders/${currentOrder.value.id}/post`), r => `Заказ проведён. ${result(r)}`);
async function deleteOrder() {
  if (!confirm(`Удалить заказ ${currentOrder.value.number}? Заказ помечается на удаление, строки АРМ удаляются.`)) return;
  sheetId.value = null;
  await run(() => api('DELETE', '/sales/customer-orders/' + currentOrder.value.id), 'Заказ удалён');
}
async function strikeLine() {
  if (!confirm('Вычеркнуть строку (и связанные закупки)?')) return;
  await run(() => api('DELETE', '/lines/' + current.value.id), 'Строка вычеркнута');
}

// отгрузка
const shipment = ref(null);
function openShipment() {
  shipment.value = { shipmentDate: new Date().toISOString().slice(0, 10), shipmentNumber: '' };
}
async function saveShipment() {
  const s = shipment.value;
  shipment.value = null;
  await run(() => post('/sales/shipments', { customerOrderId: currentOrder.value.id, ...s }), result);
}

// новый заказ
const newOrder = ref(null);
const orderPicker = ref(null);
function openNewOrder() {
  newOrder.value = { customer: null, contract: null, clientOrderNumber: '', date: new Date().toISOString().slice(0, 10) };
}
async function createOrder() {
  const o = newOrder.value;
  const doc = await run(() => post('/sales/customer-orders', {
    customerId: o.customer.id, contractId: o.contract ? o.contract.id : undefined, clientOrderNumber: o.clientOrderNumber, date: o.date
  }), d => `Создан заказ ${d.number}`);
  if (doc) {
    newOrder.value = null;
    addFor.value = { customerOrderId: doc.id, title: `Строки в заказ ${doc.number}` };
  }
}

// добавить строки (подбор номенклатуры)
const addFor = ref(null);
function openAdd() {
  if (view.value === 'sales') addFor.value = { customerOrderId: currentOrder.value.id, title: `Строки в заказ ${currentOrder.value.number}` };
  else openAddPurchase();
}
// закупка к текущей строке (продажи или закупки): та же связка строк, что у исходной
function openAddPurchase() {
  addFor.value = { purchase: true, sourceLineId: current.value.id, title: 'Закупка к строке ' + (current.value.factName || current.value.id) };
}
async function addLines(items) {
  const a = addFor.value;
  addFor.value = null;
  if (!items || !items.length) return;
  const body = a.purchase
    ? { view: 'purchases', sourceLineId: a.sourceLineId, nomenclatureIds: items.map(i => i.id) }
    : { view: 'sales', customerOrderId: a.customerOrderId, nomenclatureIds: items.map(i => i.id) };
  await run(() => post('/lines', body), r => `Добавлено строк: ${r.length}${a.purchase ? ' (список «Закупки»)' : ''}`);
}

// переходы процессов (POST /lines/transition) — к отмеченным строкам списка, по ролям, как в Арм_API.ПереходыПроцессов
const TRANSITIONS = [
  { to: 'reserve', title: 'Зарезервировать', node: 'M3', icon: 'lock', roles: ['manager', 'admin'], views: ['sales'] },
  { to: 'assembly', title: 'На комплектацию', node: 'M9 · G3', icon: 'box', roles: ['manager', 'admin', 'chief_mechanic'], views: ['sales'] },
  { to: 'ready_to_ship', title: 'Собрано', node: 'K3', icon: 'check', roles: ['storekeeper', 'manager', 'admin'], views: ['sales'] },
  { to: 'shipped', title: 'Самовывоз', node: 'N4', icon: 'supply', roles: ['manager', 'admin'], views: ['sales', 'purchases'] },
  { to: 'acceptance', title: 'Принять по УПД', node: 'K1', icon: 'file', roles: ['storekeeper', 'admin'], views: ['sales', 'purchases'] },
  { to: 'return', title: 'Возврат', node: 'N3 · M16 · K6', icon: 'undo', roles: ['manager', 'storekeeper', 'admin'], views: ['sales', 'purchases'] },
  { to: 'closed', title: 'Закрыть', node: 'M15 · K7 · G9', icon: 'check', roles: ['manager', 'storekeeper', 'admin', 'chief_mechanic'], views: ['sales', 'purchases'] }
];
const transitions = computed(() => TRANSITIONS.filter(t => t.roles.includes(session.role) && t.views.includes(view.value)));
const transition = t => { closeSheets(); return run(() => post('/lines/transition', { view: view.value, to: t.to }), r => `${t.title}: ${result(r)}`); };
// M10 (АРМ v2.23): отклонить собранное с причиной — строки снова «Комплектуется», кладовщику уведомление с причиной
const canReject = computed(() => view.value === 'sales' && ['manager', 'admin', 'chief_mechanic'].includes(session.role));
function rejectAssembly() {
  const reason = prompt('Причина отклонения комплектации (недостача, брак, не та позиция):', '');
  if (reason === null) return;
  if (!reason.trim()) { toast.show('Укажите причину — её увидит кладовщик', 'error'); return; }
  closeSheets();
  return run(() => post('/lines/reject-assembly', { reason }), r => `Комплектация отклонена: ${result(r)}`);
}

// снабжение
const SUPPLY = [['paid', 'Оплачено', 'M7'], ['in_transit', 'В пути', 'P2'], ['acceptance', 'Приёмка', 'K1'], ['to_stock', 'На склад', 'K2'],
  ['assembly', 'Комплектуется', 'M9'], ['assembled', 'Собран', 'K3']];
const partial = ref(null);
async function supplyStatus(status, extra = {}) {
  closeSheets();
  busy.value = true;
  try {
    const r = await post('/supply/status', { status, ...extra });
    toast.show(result(r), 'ok');
    await lines.load();
  } catch (e) {
    if (e.code === 'need_split') partial.value = { status, receiptDate: new Date().toISOString().slice(0, 10), message: e.message };
    else toast.error(e);
  } finally {
    busy.value = false;
  }
}
async function confirmPartial() {
  const p = partial.value;
  partial.value = null;
  await supplyStatus(p.status, { partialReceipt: true, receiptDate: p.receiptDate });
}

// ---------- действия с отмеченными
const actionsOpen = ref(false);
const selCount = computed(() => (lines.totals ? lines.totals.count : 0));

function openDocument(doc) {
  sheetId.value = null;
  router.push({ name: 'document', params: { kind: doc.kind, id: doc.id } });
}
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
</script>

<template>
  <section :class="['lines', { dense: ui.density === 'compact', 'has-sel': selCount > 0 }]">
    <Teleport to="#appbar-actions" defer>
      <button class="icon" :class="{ on: activeFilters }" aria-label="Фильтры" title="Фильтры" @click="filtersOpen = true">
        <AppIcon name="filter" /><span v-if="activeFilters" class="icon-badge">{{ activeFilters }}</span>
      </button>
      <button class="icon" :aria-label="layout === 'cards' ? 'Таблицей' : 'Карточками'" :title="layout === 'cards' ? 'Показать таблицей' : 'Показать карточками'"
              @click="ui.setLayout(layout === 'cards' ? 'table' : 'cards')"><AppIcon :name="layout === 'cards' ? 'table' : 'cards'" /></button>
      <button class="icon" aria-label="Поля" title="Отображаемые поля" @click="settings = layout === 'cards' ? 'card' : 'table'"><AppIcon name="sliders" /></button>
      <button class="icon" aria-label="Обновить" title="Обновить" :disabled="lines.loading" @click="reload"><AppIcon name="refresh" /></button>
      <button class="icon" :class="{ on: selCount }" aria-label="Действия" title="Действия с отмеченными строками" @click="actionsOpen = true"><AppIcon name="zap" /></button>
    </Teleport>

    <div class="lines-head">
      <div class="search">
        <span class="ico"><AppIcon name="search" :size="18" /></span>
        <input v-model="q" type="search" placeholder="Наименование, артикул, заказ, клиент" aria-label="Поиск по строкам" />
      </div>
      <div class="chips" role="group" aria-label="Быстрые фильтры">
        <button v-if="lines.filters.customerOrderId" class="chip on" @click="clearOrder" title="Показать все заказы">
          Заказ {{ (lines.items[0] && lines.items[0].customerOrder && lines.items[0].customerOrder.number) || lines.filters.customerOrderId.slice(0, 8) }} <AppIcon name="x" :size="14" />
        </button>
        <button class="chip" :class="{ on: lines.filters.groupByCustomerOrder }" @click="toggleFilter('groupByCustomerOrder')">По заказам</button>
        <button v-if="layout === 'table' && lines.filters.groupByCustomerOrder && groupKeys.length" class="chip" data-expand-all @click="toggleAll">
          <AppIcon :name="allOpen ? 'up' : 'down'" :size="14" /> {{ allOpen ? 'Свернуть все' : 'Развернуть все' }}
        </button>
        <button class="chip" :class="{ on: lines.filters.hideShipped }" @click="toggleFilter('hideShipped')">Без отгруженных</button>
        <button v-if="view === 'sales'" class="chip" :class="{ on: lines.filters.onlyWithPurchases }" @click="toggleFilter('onlyWithPurchases')">С закупками</button>
        <button class="chip" :class="{ on: lines.filters.periodFrom || lines.filters.periodTo }" @click="filtersOpen = true">
          {{ lines.filters.periodFrom || lines.filters.periodTo ? `${lines.filters.periodFrom || '…'} — ${lines.filters.periodTo || '…'}` : 'Период' }}
        </button>
        <button class="chip" @click="settings = layout === 'cards' ? 'card' : 'table'" title="Отображаемые поля">
          <AppIcon name="sliders" :size="14" /> Поля<template v-if="layout === 'table'">: {{ visibleColumns.length }} · {{ columnsMode }}</template>
        </button>
      </div>
      <div class="muted small lines-count">
        <span v-if="lines.loading">Загрузка…</span>
        <span v-else>Строк: {{ shown.length }}<template v-if="q"> из {{ lines.items.length }}</template><template v-if="groupKeys.length"> · заказов {{ groupKeys.length }}</template></span>
      </div>
    </div>

    <!-- карточки -->
    <div v-if="layout === 'cards'" class="cards">
      <template v-for="(r, i) in rows" :key="r.line ? r.line.id : r.key + i">
        <div v-if="!r.line" class="group-head">
          <template v-if="r.group">
            <button class="gh-main" @click="orderMenu = r">
              <span class="gh-title">{{ r.group.number }} <span class="faint">от {{ r.group.date && r.group.date.split('-').reverse().join('.') }}</span></span>
              <span class="gh-sub">{{ r.customer && r.customer.name }} · {{ r.count }} стр.</span>
            </button>
            <span :class="['chip', r.group.posted ? 'ok' : '']">{{ r.group.posted ? 'проведён' : 'черновик' }}</span>
            <button class="icon" aria-label="Действия с заказом" @click="orderMenu = r"><AppIcon name="dots" :size="22" /></button>
          </template>
          <span v-else class="muted gh-sub">Без заказа покупателя · {{ r.count }} стр.</span>
        </div>
        <LineCard v-else :line="r.line" :fields="cardFields" :current="r.line.id === lines.current" :mark-denied="markDenied(r.line)"
                  @open="openLine" @mark="toggleMark" />
      </template>
    </div>

    <!-- таблица -->
    <div v-else class="table-wrap">
      <table :class="{ dense: ui.density === 'compact' }">
        <thead>
          <tr>
            <th class="sticky-1">✓</th>
            <th>Статус</th>
            <th v-for="c in visibleColumns" :key="c.id" :title="c.title + (c.writable ? '' : ' (только чтение)')">
              <span class="code">{{ c.code }}</span>{{ c.title }}
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(r, i) in tableRows" :key="r.line ? r.line.id : r.key + i">
            <tr v-if="!r.line" :class="['group', { open: isOpen(r.key) }]" @click="toggleGroup(r.key)">
              <td class="sticky-1 g-toggle">
                <button class="icon sm-icon" :aria-expanded="isOpen(r.key)" :aria-label="(isOpen(r.key) ? 'Свернуть' : 'Развернуть') + ' заказ'" @click.stop="toggleGroup(r.key)">
                  <AppIcon :name="isOpen(r.key) ? 'down' : 'right'" :size="18" />
                </button>
              </td>
              <td :colspan="visibleColumns.length + 1" class="g-cell">
                <div class="g-line">
                  <template v-if="r.group">
                    <a href="#" class="g-num" @click.prevent.stop="openDocument(r.group)">{{ r.group.number }}</a>
                    <span class="faint">от {{ r.group.date && r.group.date.split('-').reverse().join('.') }}</span>
                    <span class="chip" :class="r.group.posted ? 'ok' : ''">{{ r.group.posted ? 'проведён' : 'не проведён' }}</span>
                    <span class="g-cust">{{ r.customer && r.customer.name }}</span>
                  </template>
                  <span v-else class="muted">Без заказа покупателя</span>
                  <span class="chip info" :title="'Строк в заказе: ' + r.count">{{ r.count }} стр.</span>
                  <span v-if="r.marked" class="chip warn">отмечено {{ r.marked }}</span>
                  <span v-for="(n, s) in r.statuses" :key="s" :class="['chip', statusTone(s)]">{{ STATUS_TITLES[s] || s }}<template v-if="n > 1"> · {{ n }}</template></span>
                  <span v-if="r.saleSum" class="g-sum">{{ money.format(r.saleSum) }}</span>
                  <span v-if="r.group" class="g-acts" @click.stop>
                    <button class="link" @click="markOrder(r.group, true)">отметить</button>
                    <button class="link" @click="markOrder(r.group, false)">снять</button>
                    <button class="link" @click="onlyOrder(r.group)">только этот</button>
                  </span>
                </div>
              </td>
            </tr>
            <tr v-else :class="{ marked: r.line.marked, current: r.line.id === lines.current, deleted: r.line.deleted }" @click="lines.current = r.line.id">
              <td class="sticky-1" :title="r.line.markedBy ? 'Отметил: ' + r.line.markedBy : ''">
                <input type="checkbox" :checked="r.line.marked" :disabled="!!markDenied(r.line)" @click.prevent="toggleMark(r.line)" />
              </td>
              <td>
                <button class="link" :title="'Подробно'" @click.stop="openLine(r.line)"><span :class="['chip', statusTone(r.line.status)]">{{ STATUS_TITLES[r.line.status] || r.line.status }}</span></button>
              </td>
              <td v-for="c in visibleColumns" :key="c.id"
                  :class="{ editable: !deny(r.line, c), num: ['number'].includes(fieldInfo(c.field).kind) }"
                  :title="deny(r.line, c) || 'Изменить'"
                  @dblclick="startEdit(r.line, c)" @keydown.enter="startEdit(r.line, c)" :tabindex="deny(r.line, c) ? -1 : 0">
                <template v-if="editing && editing.line.id === r.line.id && editing.column.id === c.id">
                  <input ref="editInput" v-model="editing.value" :type="editing.kind === 'date' ? 'date' : 'text'"
                         @keydown.enter.stop="commitEdit" @keydown.esc="editing = null" @blur="commitEdit" style="width: 150px" />
                </template>
                <template v-else>{{ display(r.line, c.field) }}</template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="!shown.length && !lines.loading" class="empty">
      <div class="big"><AppIcon name="search" :size="40" /></div>
      <div>{{ q ? 'Ничего не найдено' : 'Строк нет' }}</div>
      <button v-if="q" class="link" style="margin-top: 8px" @click="q = ''">Сбросить поиск</button>
    </div>
    <div v-if="lines.nextCursor" class="row" style="justify-content: center; padding: 12px">
      <button :disabled="lines.loading" @click="lines.loadMore()">Загрузить ещё</button>
    </div>
    <p v-if="layout === 'table'" class="muted small">Двойной клик по голубой ячейке — правка, по статусу — карточка строки. Права — по матрице роли.</p>

    <!-- новый заказ -->
    <button v-if="view === 'sales' && !selCount" class="fab primary" aria-label="Новый заказ" title="Новый заказ" :disabled="busy" @click="openNewOrder">
      <AppIcon name="plus" :size="24" /><span class="fab-label">Заказ</span>
    </button>

    <!-- панель отмеченных -->
    <div v-if="lines.totals && selCount" class="selbar totals" role="region" aria-label="Отмеченные строки">
      <div class="sb-info">
        <b>Отмечено: {{ lines.totals.count }}</b>
        <span class="muted small">Кол-во {{ money.format(lines.totals.quantity) }} · Продажа {{ money.format(lines.totals.saleSum) }} · Себест. {{ money.format(lines.totals.costSum) }}</span>
      </div>
      <button class="primary" :disabled="busy" @click="actionsOpen = true"><AppIcon name="zap" :size="18" /> Действия</button>
    </div>

    <!-- действия с отмеченными -->
    <AppModal v-if="actionsOpen" title="Действия с отмеченными" @close="actionsOpen = false">
      <p class="muted small" style="margin: 0">Отмечено строк: {{ selCount }}. Команды выполняются в 1С по вашим отметкам.</p>
      <template v-if="view === 'supply'">
        <div class="menu-title">Статус снабжения</div>
        <div class="menu">
          <button v-for="[code, title, node] in SUPPLY" :key="code" :disabled="busy" data-supply @click="supplyStatus(code)">
            <AppIcon name="supply" /> {{ title }} <span class="hint">{{ node }}</span>
          </button>
        </div>
      </template>
      <template v-else>
        <template v-if="transitions.length">
          <div class="menu-title">Процесс</div>
          <div class="menu">
            <button v-for="t in transitions" :key="t.to" :disabled="busy" data-transition @click="transition(t)">
              <AppIcon :name="t.icon" /> {{ t.title }} <span class="hint">{{ t.node }}</span>
            </button>
            <button v-if="canReject" :disabled="busy" @click="rejectAssembly">
              <AppIcon name="undo" /> Отклонить комплектацию <span class="hint">M10</span>
            </button>
          </div>
        </template>
        <div class="menu-title">Команды 1С</div>
        <div class="menu">
          <button :disabled="busy" @click="startJob()">
            <AppIcon name="zap" /> В работе <span class="hint">{{ view === 'purchases' ? 'заказ поставщику' : 'M4 · K5' }}</span>
          </button>
          <label class="row" style="justify-content: space-between; padding: 4px 12px 8px 50px">
            <span class="muted small">Разрешить сплит заказа</span>
            <span class="switch"><input type="checkbox" v-model="allowSplit" /><span></span></span>
          </label>
          <button v-if="view === 'sales'" :disabled="busy" @click="prepared"><AppIcon name="check" /> Подготовлено</button>
          <button v-if="view === 'sales'" :disabled="busy" @click="supplierOrder"><AppIcon name="purchases" /> Заказать поставщику</button>
        </div>
      </template>
      <div class="menu">
        <button :disabled="busy" @click="clearMyMarks"><AppIcon name="x" /> Снять мои отметки</button>
      </div>
      <template #actions><button @click="actionsOpen = false">Закрыть</button></template>
    </AppModal>

    <!-- меню заказа (карточки) -->
    <AppModal v-if="orderMenu" :title="`Заказ ${orderMenu.group.number}`" @close="orderMenu = null">
      <div class="muted small" style="margin-top: -6px">{{ orderMenu.customer && orderMenu.customer.name }} · {{ orderMenu.count }} стр.</div>
      <div class="menu">
        <button @click="markOrder(orderMenu.group, true)"><AppIcon name="check" /> Отметить все строки</button>
        <button @click="markOrder(orderMenu.group, false)"><AppIcon name="x" /> Снять отметки</button>
        <button @click="onlyOrder(orderMenu.group)"><AppIcon name="filter" /> Только этот заказ</button>
        <button @click="openDocument(orderMenu.group); orderMenu = null"><AppIcon name="file" /> Документ заказа</button>
      </div>
      <template #actions><button @click="orderMenu = null">Закрыть</button></template>
    </AppModal>

    <!-- фильтры -->
    <AppModal v-if="filtersOpen" title="Фильтры" @close="filtersOpen = false">
      <div class="row" style="flex-wrap: nowrap">
        <label class="field grow">С <input type="date" v-model="lines.filters.periodFrom" /></label>
        <label class="field grow">По <input type="date" v-model="lines.filters.periodTo" /></label>
      </div>
      <label class="row sw">Скрыть отгруженные <span class="switch"><input type="checkbox" v-model="lines.filters.hideShipped" /><span></span></span></label>
      <label class="row sw">Скрыть удалённые <span class="switch"><input type="checkbox" v-model="lines.filters.hideDeleted" /><span></span></span></label>
      <label v-if="view === 'sales'" class="row sw">Только с закупками <span class="switch"><input type="checkbox" v-model="lines.filters.onlyWithPurchases" /><span></span></span></label>
      <label class="row sw">Группировать по заказам <span class="switch"><input type="checkbox" v-model="lines.filters.groupByCustomerOrder" /><span></span></span></label>
      <template #actions>
        <button @click="lines.resetFilters(); applyFilters()">Сбросить</button>
        <button class="primary" @click="applyFilters">Показать</button>
      </template>
    </AppModal>

    <!-- диалоги -->
    <LineSheet v-if="sheetLine" :line="sheetLine" :columns="matrix.columns" :deny="deny" :mark-denied="markDenied(sheetLine)"
               :editable-first="pref.detailEditableFirst" :hide-empty="pref.detailHideEmpty" :actions="sheetActions" :busy="busy"
               @close="sheetId = null" @save="(c, v) => save(sheetLine, c, v)" @pick="c => openPicker(sheetLine, c)"
               @mark="toggleMark" @action="sheetAction" @document="openDocument" />

    <RefPicker v-if="picker" :dir="picker.dir" :query="picker.query" :title="picker.column.title" allow-clear
               @pick="picked" @close="picker = null" />

    <RefPicker v-if="addFor" dir="nomenclature" :title="addFor.title" multiple @pick="addLines" @close="addFor = null" />

    <JobDialog v-if="job" :job="job" @close="jobClosed" @split="job = null; startJob(true)" />

    <AppModal v-if="shipment" title="Отгрузка по заказу" @close="shipment = null">
      <p class="muted small" style="margin: 0">Заказ {{ currentOrder && currentOrder.number }}: строки «Готово к отгрузке» и «Возврат», а также строки с партией в «Новый» / «В работе».</p>
      <label class="field">Дата <input type="date" v-model="shipment.shipmentDate" /></label>
      <label class="field">Номер <input v-model="shipment.shipmentNumber" autofocus /></label>
      <template #actions>
        <button @click="shipment = null">Отмена</button>
        <button class="primary" :disabled="!shipment.shipmentDate || !shipment.shipmentNumber" @click="saveShipment">Записать</button>
      </template>
    </AppModal>

    <AppModal v-if="newOrder" title="Новый заказ покупателя" @close="newOrder = null">
      <label class="field">Заказчик <button @click="orderPicker = 'customer'">{{ newOrder.customer ? newOrder.customer.name : 'Выбрать…' }} <AppIcon name="right" :size="18" /></button></label>
      <label class="field">Договор <button :disabled="!newOrder.customer" @click="orderPicker = 'contract'">{{ newOrder.contract ? newOrder.contract.name : 'По умолчанию' }} <AppIcon name="right" :size="18" /></button></label>
      <label class="field">№ заказа клиента <input v-model="newOrder.clientOrderNumber" /></label>
      <label class="field">Дата <input type="date" v-model="newOrder.date" /></label>
      <template #actions>
        <button @click="newOrder = null">Отмена</button>
        <button class="primary" :disabled="!newOrder.customer || busy" @click="createOrder">Создать</button>
      </template>
    </AppModal>
    <RefPicker v-if="orderPicker === 'customer'" dir="counterparties" title="Заказчик"
               @pick="v => { newOrder.customer = v; newOrder.contract = null; orderPicker = null }" @close="orderPicker = null" />
    <RefPicker v-if="orderPicker === 'contract'" dir="contracts" :query="{ ownerId: newOrder.customer.id }" title="Договор"
               @pick="v => { newOrder.contract = v; orderPicker = null }" @close="orderPicker = null" />

    <AppModal v-if="partial" title="Частичный приход" @close="partial = null">
      <p style="margin: 0">{{ partial.message }}</p>
      <label class="field">Дата поступления <input type="date" v-model="partial.receiptDate" /></label>
      <template #actions>
        <button @click="partial = null">Отмена</button>
        <button class="primary" @click="confirmPartial">Принять частично</button>
      </template>
    </AppModal>

    <FieldSettings v-if="settings" :role="session.role" :view="view" :columns="matrix.columns" :tab="settings"
                   :sample="lines.currentLine || lines.items[0] || null" @close="settings = null" />
  </section>
</template>

<style scoped>
.lines { display: flex; flex-direction: column; gap: 10px; }
.lines.has-sel { padding-bottom: 84px; }
.lines-head { display: flex; flex-direction: column; gap: 8px; }
.lines-count { padding: 0 4px; }
@media (min-width: 900px) {
  .lines-head { flex-direction: row; align-items: center; flex-wrap: wrap; }
  .lines-head .search { max-width: 420px; }
  .lines-count { margin-left: auto; }
}
.cards { display: flex; flex-direction: column; gap: 8px; }
@media (min-width: 900px) { .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); align-items: start; } .group-head { grid-column: 1 / -1; } }
.group-head { display: flex; align-items: center; gap: 6px; padding: 10px 2px 2px; position: sticky; top: calc(var(--bar-h) + var(--safe-t)); z-index: 5;
  background: linear-gradient(var(--bg) 80%, transparent); }
.gh-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 0; border: 0; background: none; padding: 0; min-height: 40px; text-align: left; }
.gh-main:hover { background: none !important; }
.gh-title { font-weight: 700; font-size: 15px; }
.gh-sub { font-size: 12px; color: var(--fg-2); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.sw { justify-content: space-between; min-height: 44px; }

/* заказы-аккордеон в таблице */
tr.group { cursor: pointer; }
tr.group td { background: var(--surface-2); }
tr.group.open td { background: color-mix(in srgb, var(--accent-2) 55%, var(--surface)); }
tr.group:hover td { background: color-mix(in srgb, var(--accent-2) 75%, var(--surface)); }
.g-toggle { width: 44px; text-align: center; padding: 2px 4px !important; }
.sm-icon { width: 32px; height: 32px; min-height: 32px; }
.g-cell { max-width: none !important; overflow: visible !important; padding: 4px 10px !important; }
.g-line { display: flex; align-items: center; gap: 8px; position: sticky; left: 54px; width: max-content; }
.g-num { font-weight: 700; }
.g-cust { font-weight: 600; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.g-sum { font-variant-numeric: tabular-nums; font-weight: 700; }
.g-acts { display: inline-flex; gap: 14px; margin-left: 10px; font-size: 12px; }
.icon-badge { position: absolute; top: 3px; right: 3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--err);
  color: #fff; font-size: 10px; font-weight: 700; line-height: 17px; text-align: center; box-shadow: 0 0 0 2px var(--surface); pointer-events: none; }

.fab { position: fixed; right: 16px; bottom: calc(var(--nav-h) + var(--safe-b) + 16px); z-index: 35; height: 56px; min-width: 56px; border-radius: 18px;
  padding: 0 18px; box-shadow: var(--shadow-2); }
.fab-label { display: none; }
@media (min-width: 900px) { .fab { bottom: 24px; right: 24px; } .fab-label { display: inline; } }

.selbar { position: fixed; left: 8px; right: 8px; bottom: calc(var(--nav-h) + var(--safe-b) + 8px); z-index: 35; display: flex; align-items: center; gap: 12px;
  padding: 10px 10px 10px 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-2); animation: up .2s; }
.sb-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sb-info .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (min-width: 900px) { .selbar { left: calc(232px + 24px); right: 24px; bottom: 20px; max-width: 900px; } }
</style>
