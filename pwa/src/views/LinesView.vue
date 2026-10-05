<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useMatrixStore } from '../stores/matrix';
import { useLinesStore } from '../stores/lines';
import { useToastStore } from '../stores/toast';
import { api, post } from '../api';
import { fieldInfo, valueOf, display, STATUS_TITLES } from '../lib/columns';
import { useColumnsStore, STAGES } from '../stores/columns';
import RefPicker from '../components/RefPicker.vue';
import ColumnChooser from '../components/ColumnChooser.vue';
import AppModal from '../components/AppModal.vue';
import JobDialog from '../components/JobDialog.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const matrix = useMatrixStore();
const lines = useLinesStore();
const toast = useToastStore();
const columnsPref = useColumnsStore();

const view = computed(() => route.params.view);
const userName = computed(() => session.user && session.user.userName);

// ---------- колонки (настройка — по роли и списку, см. stores/columns.js)
const chooser = ref(false);
const isEmpty = (line, c) => {
  const v = valueOf(line, c.field);
  return v === undefined || v === null || v === '' || v === 0 || v === false;
};
const visibleColumns = computed(() => columnsPref.visible(session.role, view.value, matrix.columns, lines.items, isEmpty));
const columnsMode = computed(() => {
  const p = columnsPref.pref(session.role, view.value);
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
watch(view, reload, { immediate: true });

const rows = computed(() => {
  if (!lines.filters.groupByCustomerOrder) return lines.items.map(l => ({ line: l }));
  const out = [];
  let key;
  for (const l of lines.items) {
    const k = l.customerOrder ? l.customerOrder.id : '';
    if (k !== key) {
      key = k;
      out.push({ group: l.customerOrder, customer: l.customer, count: lines.items.filter(x => (x.customerOrder ? x.customerOrder.id : '') === k).length });
    }
    out.push({ line: l });
  }
  return out;
});

// ---------- редактирование ячеек
const editing = ref(null); // { line, column, value }
const picker = ref(null); // { line, column, dir, query }
const editInput = ref(null);

function deny(line, column) {
  return matrix.denyReason(column, line, userName.value);
}
async function startEdit(line, column) {
  lines.current = line.id;
  if (deny(line, column)) return;
  const info = fieldInfo(column.field);
  if (info.kind === 'bool') return save(line, column, !valueOf(line, column.field));
  if (info.kind === 'ref' || info.kind === 'nomenclature') {
    picker.value = { line, column, dir: info.dir, query: info.query ? info.query(line) : {} };
    return;
  }
  const v = valueOf(line, column.field);
  editing.value = { line, column, value: v == null ? '' : String(v), kind: info.kind };
  await nextTick();
  const el = editInput.value && (Array.isArray(editInput.value) ? editInput.value[0] : editInput.value);
  if (el) { el.focus(); el.select && el.select(); }
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

// ---------- отметки
async function toggleMark(line) {
  lines.current = line.id;
  try { await lines.toggleMark(line); } catch (e) { toast.error(e); }
}
async function markOrder(order, marked) {
  try {
    const r = await lines.markOrder(order.id, marked);
    toast.show(`${marked ? 'Отмечено' : 'Снято'}: ${r.processed} из ${r.total}`, 'ok');
  } catch (e) { toast.error(e); }
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
  busy.value = true;
  try {
    job.value = await post('/sales/jobs', { allowSplit: split });
  } catch (e) { toast.error(e); } finally { busy.value = false; }
}
function jobClosed() {
  job.value = null;
  lines.load().catch(e => toast.error(e));
}

const prepared = () => run(() => post('/sales/prepared'), result);
const postOrder = () => run(() => post(`/sales/customer-orders/${currentOrder.value.id}/post`), r => `Заказ проведён. ${result(r)}`);
async function deleteOrder() {
  if (!confirm(`Удалить заказ ${currentOrder.value.number}? Заказ помечается на удаление, строки АРМ удаляются.`)) return;
  await run(() => api('DELETE', '/sales/customer-orders/' + currentOrder.value.id), 'Заказ удалён');
}
async function strikeLine() {
  if (!confirm('Вычеркнуть строку (и связанные закупки)?')) return;
  await run(() => api('DELETE', '/lines/' + current.value.id), 'Строка вычеркнута');
}
const supplierOrder = () => run(() => post('/sales/supplier-orders', {}), result);

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
  { to: 'reserve', title: 'Зарезервировать', node: 'M3', roles: ['manager', 'admin'], views: ['sales'] },
  { to: 'assembly', title: 'На комплектацию', node: 'M9 / M10 / G3', roles: ['manager', 'admin', 'chief_mechanic'], views: ['sales'] },
  { to: 'ready_to_ship', title: 'Собрано', node: 'K3', roles: ['storekeeper', 'manager', 'admin'], views: ['sales'] },
  { to: 'shipped', title: 'Самовывоз', node: 'N4', roles: ['manager', 'admin'], views: ['sales', 'purchases'] },
  { to: 'acceptance', title: 'Принять по УПД', node: 'K1', roles: ['storekeeper', 'admin'], views: ['sales', 'purchases'] },
  { to: 'return', title: 'Возврат', node: 'N3 / M16 / K6', roles: ['manager', 'storekeeper', 'admin'], views: ['sales', 'purchases'] },
  { to: 'closed', title: 'Закрыть', node: 'M15 / K7 / G9', roles: ['manager', 'storekeeper', 'admin', 'chief_mechanic'], views: ['sales', 'purchases'] }
];
const transitions = computed(() => TRANSITIONS.filter(t => t.roles.includes(session.role) && t.views.includes(view.value)));
const transition = t => run(() => post('/lines/transition', { view: view.value, to: t.to }), r => `${t.title}: ${result(r)}`);

// снабжение
const SUPPLY =[['paid', 'Оплачено'], ['in_transit', 'В пути'], ['acceptance', 'Приёмка'], ['to_stock', 'На склад'], ['assembly', 'Комплектуется'], ['assembled', 'Собран']];
const partial = ref(null);
async function supplyStatus(status, extra = {}) {
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

function openDocument(doc) {
  router.push({ name: 'document', params: { kind: doc.kind, id: doc.id } });
}
function statusClass(s) {
  return { closed: 'ok', shipped: 'ok', ready_to_ship: 'ok', locked_background: 'err', return: 'err', in_work: 'warn' }[s] || '';
}
const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
</script>

<template>
  <section>
    <div class="toolbar">
      <label>с <input type="date" v-model="lines.filters.periodFrom" /></label>
      <label>по <input type="date" v-model="lines.filters.periodTo" /></label>
      <label><input type="checkbox" v-model="lines.filters.hideShipped" /> скрыть отгруженные</label>
      <label><input type="checkbox" v-model="lines.filters.hideDeleted" /> скрыть удалённые</label>
      <label v-if="view === 'sales'"><input type="checkbox" v-model="lines.filters.onlyWithPurchases" /> только с закупками</label>
      <label><input type="checkbox" v-model="lines.filters.groupByCustomerOrder" /> по заказам</label>
      <label v-if="lines.filters.customerOrderId" class="chip">заказ {{ lines.filters.customerOrderId.slice(0, 8) }}…
        <button class="link" @click="lines.filters.customerOrderId = ''">×</button></label>
      <button class="primary" :disabled="lines.loading" @click="reload">{{ lines.loading ? 'Загрузка…' : 'Обновить' }}</button>
      <button class="link" @click="lines.resetFilters()">сбросить</button>
      <button @click="chooser = true" title="Какие поля показывать">Колонки ({{ visibleColumns.length }}<template v-if="columnsMode">: {{ columnsMode }}</template>)</button>
    </div>

    <div class="toolbar" v-if="view === 'sales'">
      <button :disabled="busy" @click="startJob()" title="POST /sales/jobs">В работе</button>
      <label><input type="checkbox" v-model="allowSplit" /> разрешить сплит</label>
      <button :disabled="busy" @click="prepared" title="POST /sales/prepared">Подготовлено</button>
      <button :disabled="busy" @click="openNewOrder" title="POST /sales/customer-orders">Новый заказ</button>
      <button :disabled="busy || !currentOrder" @click="openAdd" title="POST /lines">Добавить строки</button>
      <button :disabled="busy || !current" @click="openAddPurchase" title="POST /lines view=purchases, sourceLineId — текущая строка">Закупка к строке</button>
      <button :disabled="busy || !currentOrder" @click="openShipment" title="POST /sales/shipments">Отгрузка</button>
      <button :disabled="busy || !currentOrder" @click="postOrder" title="POST /sales/customer-orders/{id}/post">Провести заказ</button>
      <button :disabled="busy || !currentOrder" class="danger" @click="deleteOrder" title="DELETE /sales/customer-orders/{id}">Удалить заказ</button>
      <button :disabled="busy || !current" class="danger" @click="strikeLine" title="DELETE /lines/{id}">Вычеркнуть</button>
      <button :disabled="busy" @click="supplierOrder" title="POST /sales/supplier-orders">Заказать поставщику</button>
    </div>
    <div class="toolbar" v-else-if="view === 'purchases'">
      <button :disabled="busy" @click="startJob()" title="POST /sales/jobs — по отмеченным закупкам создаётся заказ поставщику">В работе</button>
      <label><input type="checkbox" v-model="allowSplit" /> разрешить сплит</label>
      <button :disabled="busy || !current" @click="openAdd" title="POST /lines view=purchases">Добавить закупку к строке</button>
      <button :disabled="busy || !current" class="danger" @click="strikeLine" title="DELETE /lines/{id}">Вычеркнуть</button>
    </div>
    <div class="toolbar" v-if="view !== 'supply' && transitions.length">
      <span class="muted">Отмеченные строки →</span>
      <button v-for="t in transitions" :key="t.to" :disabled="busy" @click="transition(t)"
              :title="`POST /lines/transition ${t.to} — узлы ${t.node}`">{{ t.title }}</button>
    </div>
    <div class="toolbar" v-if="view === 'supply'">
      <span class="muted">Отмеченные закупки →</span>
      <button v-for="[code, title] in SUPPLY" :key="code" :disabled="busy" @click="supplyStatus(code)" :title="'POST /supply/status ' + code">{{ title }}</button>
    </div>

    <div class="totals" v-if="lines.totals">
      <span>Отмечено: <b>{{ lines.totals.count }}</b></span>
      <span>Кол-во: <b>{{ money.format(lines.totals.quantity) }}</b></span>
      <span>Продажа: <b>{{ money.format(lines.totals.saleSum) }}</b></span>
      <span>Себестоимость: <b>{{ money.format(lines.totals.costSum) }}</b></span>
      <span class="muted" v-if="current">Текущая: {{ current.factName || (current.nomenclature && current.nomenclature.name) || current.id.slice(0, 8) }}
        <template v-if="currentOrder"> · {{ currentOrder.number }}</template></span>
    </div>

    <div class="table-wrap" style="margin-top: 8px">
      <table>
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
          <template v-for="(r, i) in rows" :key="r.line ? r.line.id : 'g' + i">
            <tr v-if="!r.line" class="group">
              <td class="sticky-1"></td>
              <td :colspan="visibleColumns.length + 1">
                <template v-if="r.group">
                  <a href="#" @click.prevent="openDocument(r.group)">{{ r.group.number }} от {{ r.group.date }}</a>
                  <span class="chip" :class="r.group.posted ? 'ok' : ''">{{ r.group.posted ? 'проведён' : 'не проведён' }}</span>
                  {{ r.customer && r.customer.name }} · строк {{ r.count }}
                  <button class="link" @click="markOrder(r.group, true)">отметить заказ</button> ·
                  <button class="link" @click="markOrder(r.group, false)">снять</button> ·
                  <button class="link" @click="lines.filters.customerOrderId = r.group.id; reload()">только этот заказ</button>
                </template>
                <span v-else class="muted">без заказа покупателя</span>
              </td>
            </tr>
            <tr v-else :class="{ marked: r.line.marked, current: r.line.id === lines.current, deleted: r.line.deleted }" @click="lines.current = r.line.id">
              <td class="sticky-1" :title="r.line.markedBy ? 'Отметил: ' + r.line.markedBy : ''">
                <input type="checkbox" :checked="r.line.marked" :disabled="r.line.locked || (r.line.markedBy && r.line.markedBy !== userName)" @click.prevent="toggleMark(r.line)" />
              </td>
              <td><span :class="['chip', statusClass(r.line.status)]">{{ STATUS_TITLES[r.line.status] || r.line.status }}</span></td>
              <td v-for="c in visibleColumns" :key="c.id"
                  :class="{ editable: !deny(r.line, c), num: ['number'].includes(fieldInfo(c.field).kind) }"
                  :title="deny(r.line, c) || 'Изменить'"
                  @dblclick="startEdit(r.line, c)" @keydown.enter="startEdit(r.line, c)" :tabindex="deny(r.line, c) ? -1 : 0">
                <template v-if="editing && editing.line.id === r.line.id && editing.column.id === c.id">
                  <input ref="editInput" v-model="editing.value" :type="editing.kind === 'date' ? 'date' : 'text'"
                         @keydown.enter.stop="commitEdit" @keydown.esc="editing = null" @blur="commitEdit" style="width: 140px" />
                </template>
                <template v-else>{{ display(r.line, c.field) }}</template>
              </td>
            </tr>
          </template>
          <tr v-if="!lines.items.length && !lines.loading"><td :colspan="visibleColumns.length + 2" class="muted">Строк нет</td></tr>
        </tbody>
      </table>
    </div>
    <div class="toolbar">
      <span class="muted">Строк: {{ lines.items.length }} · двойной клик по голубой ячейке — правка (PATCH), права — по матрице роли</span>
      <button v-if="lines.nextCursor" :disabled="lines.loading" @click="lines.loadMore()">Ещё</button>
    </div>

    <!-- диалоги -->
    <RefPicker v-if="picker" :dir="picker.dir" :query="picker.query" :title="picker.column.title" allow-clear
               @pick="picked" @close="picker = null" />

    <RefPicker v-if="addFor" dir="nomenclature" :title="addFor.title" multiple @pick="addLines" @close="addFor = null" />

    <JobDialog v-if="job" :job="job" @close="jobClosed" @split="job = null; startJob(true)" />

    <AppModal v-if="shipment" title="Отгрузка по заказу" @close="shipment = null">
      <p class="muted">Заказ {{ currentOrder && currentOrder.number }}: строки «Готово к отгрузке» и «Возврат», а также строки с партией в «Новый» / «В работе».</p>
      <label>Дата <input type="date" v-model="shipment.shipmentDate" /></label>
      <label>Номер <input v-model="shipment.shipmentNumber" /></label>
      <template #actions>
        <button @click="shipment = null">Отмена</button>
        <button class="primary" :disabled="!shipment.shipmentDate || !shipment.shipmentNumber" @click="saveShipment">Записать</button>
      </template>
    </AppModal>

    <AppModal v-if="newOrder" title="Новый заказ покупателя" @close="newOrder = null">
      <label>Заказчик <button @click="orderPicker = 'customer'">{{ newOrder.customer ? newOrder.customer.name : 'выбрать…' }}</button></label>
      <label>Договор <button :disabled="!newOrder.customer" @click="orderPicker = 'contract'">{{ newOrder.contract ? newOrder.contract.name : 'по умолчанию' }}</button></label>
      <label>№ заказа клиента <input v-model="newOrder.clientOrderNumber" /></label>
      <label>Дата <input type="date" v-model="newOrder.date" /></label>
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
      <p>{{ partial.message }}</p>
      <label>Дата поступления <input type="date" v-model="partial.receiptDate" /></label>
      <template #actions>
        <button @click="partial = null">Отмена</button>
        <button class="primary" @click="confirmPartial">Принять частично</button>
      </template>
    </AppModal>

    <ColumnChooser v-if="chooser" :role="session.role" :view="view" :columns="matrix.columns" @close="chooser = false" />
  </section>
</template>
