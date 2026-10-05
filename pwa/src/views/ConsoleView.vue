<script setup>
// Консоль API: любой из 29 запросов контракта с правкой пути/параметров/тела; smoke-прогон всех GET.
import { ref, reactive, computed, watch } from 'vue';
import { api } from '../api';
import { useSessionStore } from '../stores/session';
import { OPERATIONS, fill } from '../lib/operations';
import { load as loadPref, save as savePref } from '../storage';

const session = useSessionStore();
const ctx = reactive({
  lineId: '', customerOrderId: '', customerId: '', contractId: '', nomenclatureId: '', jobId: '',
  today: new Date().toISOString().slice(0, 10),
  ...loadPref('console.ctx', {})
});
watch(ctx, v => savePref('console.ctx', v), { deep: true });

const selectedId = ref(0);
const op = computed(() => OPERATIONS[selectedId.value]);
const path = ref('');
const query = ref('');
const body = ref('');
const response = ref(null);
const running = ref(false);

function prepare() {
  const o = op.value;
  path.value = fill(o.path, ctx);
  query.value = o.query ? JSON.stringify(fill(o.query, ctx), null, 2) : '';
  body.value = o.body !== undefined ? JSON.stringify(fill(o.body, ctx), null, 2) : '';
  response.value = null;
}
watch(selectedId, prepare, { immediate: true });

// id из ответов — в контекст для следующих запросов
function learn(data) {
  if (!data || typeof data !== 'object') return;
  const first = Array.isArray(data) ? data[0] : data.items ? data.items[0] : data;
  if (!first) return;
  if (first.linkKey !== undefined && first.id) {
    ctx.lineId = first.id;
    if (first.customerOrder) ctx.customerOrderId = first.customerOrder.id;
    if (first.customer) ctx.customerId = first.customer.id;
    if (first.nomenclature) ctx.nomenclatureId = first.nomenclature.id;
  }
  if (first.kind === 'customer_order' && first.id) ctx.customerOrderId = first.id;
  if (first.state && first.id) ctx.jobId = first.id;
  if (first.token) { /* токен сохраняет только экран входа */ }
}

async function send() {
  running.value = true;
  response.value = null;
  try {
    const q = query.value.trim() ? JSON.parse(query.value) : undefined;
    const b = body.value.trim() ? JSON.parse(body.value) : undefined;
    const t0 = performance.now();
    try {
      const r = await api(op.value.method, path.value, { query: q, body: b });
      response.value = { status: r.status, ms: Math.round(performance.now() - t0), data: r.data, etag: r.headers.get('ETag') };
      learn(r.data);
    } catch (e) {
      response.value = { status: e.status, ms: Math.round(performance.now() - t0), data: e.problem };
    }
  } catch (e) {
    response.value = { status: 'JSON', data: 'Ошибка в JSON параметров или тела: ' + e.message };
  } finally {
    running.value = false;
  }
}

// ---- smoke: все GET по очереди, id берутся из предыдущих ответов
const smoke = ref([]);
async function runSmoke() {
  smoke.value = [];
  const step = async (title, path, query) => {
    const row = reactive({ title, status: '…', ms: 0, note: '' });
    smoke.value.push(row);
    const t0 = performance.now();
    try {
      const r = await api('GET', path, { query });
      row.status = r.status;
      row.ms = Math.round(performance.now() - t0);
      return r.data;
    } catch (e) {
      row.status = e.status;
      row.ms = Math.round(performance.now() - t0);
      row.note = `${e.code}: ${e.message}`;
      return null;
    }
  };
  await step('GET /session', '/session');
  await step('GET /matrix', '/matrix');
  const views = session.views;
  const page = await step('GET /lines', '/lines', { view: views[0], limit: 50 });
  const line = page && page.items && page.items[0];
  if (line) learn(page);
  await step('GET /lines/{lineId}', '/lines/' + (line ? line.id : ctx.lineId));
  await step('GET /selection', '/selection', { view: views[0] });
  const withOrder = page && page.items.find(l => l.customerOrder);
  await step('GET /documents/{kind}/{id}', `/documents/customer_order/${withOrder ? withOrder.customerOrder.id : ctx.customerOrderId}`);
  const cps = await step('GET /directories/counterparties', '/directories/counterparties');
  if (cps && cps[0] && !ctx.customerId) ctx.customerId = cps[0].id;
  const cts = await step('GET /directories/contracts', '/directories/contracts', { ownerId: ctx.customerId });
  if (cts && cts[0]) ctx.contractId = cts[0].id;
  const noms = await step('GET /directories/nomenclature', '/directories/nomenclature', { q: 'а' });
  if (noms && noms[0]) ctx.nomenclatureId = noms[0].id;
  await step('GET /directories/batches', '/directories/batches', { nomenclatureId: ctx.nomenclatureId });
  await step('GET /directories/service-types', '/directories/service-types');
  await step('GET /directories/payment-forms', '/directories/payment-forms');
  if (ctx.jobId) await step('GET /jobs/{jobId}', '/jobs/' + ctx.jobId);
  else smoke.value.push({ title: 'GET /jobs/{jobId}', status: '—', ms: 0, note: 'нет id задания: выполните POST /sales/jobs' });
}
const smokeOk = computed(() => smoke.value.filter(r => r.status >= 200 && r.status < 400).length);
const cls = s => (typeof s !== 'number' ? '' : s >= 500 ? 'err' : s >= 400 ? 'warn' : 'ok');
const groups = computed(() => [...new Set(OPERATIONS.map(o => o.group))]);
</script>

<template>
  <section class="console">
    <aside class="ops">
      <template v-for="g in groups" :key="g">
        <div class="muted group-title">{{ g }}</div>
        <div v-for="o in OPERATIONS.filter(o => o.group === g)" :key="o.id"
             :class="['op', { sel: o.id === selectedId }]" @click="selectedId = o.id">
          <b :class="'m-' + o.method">{{ o.method }}</b> {{ o.path }}
        </div>
      </template>
    </aside>

    <div class="col main-col">
      <div class="card col">
        <div class="row">
          <b :class="'m-' + op.method">{{ op.method }}</b>
          <input v-model="path" style="flex: 1; min-width: 220px" />
          <button class="primary" :disabled="running" @click="send">{{ running ? '…' : 'Отправить' }}</button>
          <button @click="prepare">Шаблон</button>
        </div>
        <p v-if="op.note" class="muted" style="margin: 0">{{ op.note }}</p>
        <div class="row" style="align-items: stretch">
          <label class="col grow" v-if="query || op.method === 'GET'">Параметры (JSON)<textarea v-model="query" rows="6"></textarea></label>
          <label class="col grow" v-if="op.method !== 'GET'">Тело (JSON)<textarea v-model="body" rows="6"></textarea></label>
        </div>
      </div>

      <div class="card col" v-if="response">
        <div class="row">
          <span :class="['chip', cls(response.status)]">{{ response.status }}</span>
          <span class="muted">{{ response.ms }} мс</span>
          <span v-if="response.etag" class="muted">ETag {{ response.etag }}</span>
        </div>
        <pre>{{ response.data === undefined ? '(пустое тело)' : typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2) }}</pre>
      </div>

      <div class="card col">
        <div class="row"><b>Контекст</b><span class="muted">подставляется в {имя}; заполняется из ответов</span></div>
        <div class="ctx">
          <label v-for="(v, k) in ctx" :key="k">{{ k }} <input v-model="ctx[k]" /></label>
        </div>
      </div>

      <div class="card col">
        <div class="row">
          <b>Smoke: все операции чтения</b>
          <button @click="runSmoke">Запустить</button>
          <span v-if="smoke.length" class="muted">успешно {{ smokeOk }} из {{ smoke.length }}</span>
        </div>
        <table v-if="smoke.length">
          <tbody>
            <tr v-for="r in smoke" :key="r.title">
              <td>{{ r.title }}</td>
              <td><span :class="['chip', cls(r.status)]">{{ r.status }}</span></td>
              <td class="num">{{ r.ms }} мс</td>
              <td class="muted">{{ r.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.console { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
.ops { border: 1px solid var(--line); border-radius: 8px; max-height: calc(100vh - 100px); overflow: auto; position: sticky; top: 60px; }
.group-title { padding: 8px 10px 2px; font-size: 12px; }
.op { padding: 4px 10px; cursor: pointer; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op:hover, .op.sel { background: var(--edit); }
.m-GET { color: var(--ok); }
.m-POST { color: var(--accent); }
.m-PATCH { color: var(--warn); }
.m-DELETE { color: var(--err); }
.grow { flex: 1; min-width: 240px; align-items: stretch; }
.ctx { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 6px; }
.ctx label { justify-content: space-between; }
.ctx input { width: 220px; }
.main-col { min-width: 0; }
@media (max-width: 800px) {
  .console { grid-template-columns: 1fr; }
  .ops { position: static; max-height: 240px; }
}
</style>
