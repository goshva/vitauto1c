<script setup>
// POST /sales/imports — лист покупателя: строки вставляются из Excel (табуляция) или CSV (;).
// POST /sales/imports/file — тот же лист файлом .xlsx / .csv (M1): парсит сервер, предупреждения — в ответе.
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { post } from '../api';
import { useSessionStore } from '../stores/session';
import { useToastStore } from '../stores/toast';
import RefPicker from '../components/RefPicker.vue';
import AppIcon from '../components/AppIcon.vue';
import FileDropImport from '../components/FileDropImport.vue';

const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();

const COLS = ['clientNumber', 'urgency', 'plate', 'territory', 'article', 'name', 'quantity'];
const TITLES = ['№ заказа клиента', 'Срочность', 'ГРЗ', 'Территория', 'Артикул', 'Наименование', 'Кол-во'];

const customer = ref(null);
const contract = ref(null);
const pick = ref(null);
const text = ref('З-101\tсрочно\tА123ВС77\tСклад 1\tOC-90\tФильтр масляный\t2\nЗ-101\t\tА123ВС77\tСклад 1\tBKR6E\tСвеча зажигания\t4');
const busy = ref(false);
const uploading = ref(false);
const warnings = ref([]);

const rows = computed(() => text.value.split(/\r?\n/).filter(s => s.trim()).map(s => {
  const parts = s.split(s.includes('\t') ? '\t' : ';');
  return Object.fromEntries(COLS.map((c, i) => [c, (parts[i] || '').trim()]));
}));

async function submit() {
  if (!customer.value) { toast.show('Выберите заказчика', 'error'); return; }
  if (!rows.value.length) { toast.show('Нет строк для загрузки', 'error'); return; }
  busy.value = true;
  try {
    const doc = await post('/sales/imports', {
      customerId: customer.value.id,
      contractId: contract.value ? contract.value.id : undefined,
      rows: rows.value
    });
    toast.show(`Создан заказ ${doc.number} (${rows.value.length} строк)`, 'ok');
    router.push({ name: 'document', params: { kind: 'customer_order', id: doc.id } });
  } catch (e) {
    toast.show(e.message || String(e), 'error');
  } finally {
    busy.value = false;
  }
}

// M1: лист покупателя файлом .xlsx / .csv — парсит сервер (POST /sales/imports/file, multipart)
async function submitFile(f) {
  if (!customer.value) { toast.show('Выберите заказчика', 'error'); return; }
  if (!f) { toast.show('Выберите файл .xlsx или .csv', 'error'); return; }
  busy.value = true;
  warnings.value = [];
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('customerId', String(customer.value.id));
    if (contract.value) fd.append('contractId', String(contract.value.id));
    const res = await fetch(`/api/v1/sales/imports/file`, {
      method: 'POST',
      headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
      body: fd
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((data && (data.message || data.error)) || `HTTP ${res.status}`), { code: data && data.code });
    warnings.value = (data && data.warnings) || [];
    const doc = data && (data.doc || data.document);
    if (!doc || !doc.id) throw new Error('Сервер не вернул документ');
    toast.show(`Создан заказ ${doc.number}`, 'ok');
    router.push({ name: 'document', params: { kind: 'customer_order', id: doc.id } });
  } catch (e) {
    toast.show(e.message || String(e), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="page import">
    <p class="muted small" style="margin: 0">
      Лист покупателя → новый заказ: строки клиента попадают в АРМ (узлы N1, M1).
      Вставьте строки из Excel или загрузите файл.
    </p>

    <!-- Общие поля: Заказчик и Договор — нужны в обоих режимах -->
    <div class="imp-grid" style="margin-top: 12px">
      <label class="field">Заказчик
        <button @click="pick = 'customer'">
          {{ customer ? customer.name : 'Выбрать…' }}
          <AppIcon name="right" :size="18" />
        </button>
      </label>
      <label class="field">Договор
        <button :disabled="!customer" @click="pick = 'contract'">
          {{ contract ? contract.name : 'По умолчанию' }}
          <AppIcon name="right" :size="18" />
        </button>
      </label>
    </div>

    <!-- Вкладки режима. Табы явные: подчёркивание активного, без пунктира. -->
    <div class="imp-tabs" role="tablist" aria-label="Способ загрузки листа">
      <button
        type="button"
        role="tab"
        class="imp-tab"
        :class="{ on: !uploading }"
        :aria-selected="String(!uploading)"
        @click="uploading = false"
      >
        <AppIcon name="edit" :size="14" /> Вставить вручную
      </button>

      <button
        type="button"
        role="tab"
        class="imp-tab"
        :class="{ on: uploading }"
        :aria-selected="String(uploading)"
        @click="uploading = true"
      >
        <AppIcon name="upload" :size="14" /> Загрузить файл .xlsx / .csv
      </button>

      <!-- «Скачать шаблон» — действие, доступное только в режиме загрузки файла -->
      <a
        v-if="uploading"
        class="imp-tab-action"
        href="/заказExel.xlsx"
        download="заказExel.xlsx"
        title="Скачать шаблон Excel для заполнения"
      >
        <AppIcon name="download" :size="14" /> Скачать шаблон
      </a>
    </div>

    <!-- ручное вставление -->
    <div v-if="!uploading">
      <label class="field">Строки — колонки через Tab или «;»
        <textarea v-model="text" rows="7" spellcheck="false"></textarea>
        <span class="faint small" style="font-weight: 400">{{ TITLES.join(' · ') }}</span>
      </label>
      <div class="menu-title" style="padding-left: 0">Предпросмотр: {{ rows.length }} стр.</div>
      <div class="imp-rows">
        <div v-for="(r, i) in rows" :key="i" class="card imp-row">
          <div class="row" style="justify-content: space-between; flex-wrap: nowrap">
            <b class="grow">{{ r.name || 'без наименования' }}</b>
            <span class="chip info">× {{ r.quantity || '—' }}</span>
          </div>
          <div class="muted small">
            <span v-if="r.article">арт. {{ r.article }}</span>
            <span v-if="r.clientNumber"> · № {{ r.clientNumber }}</span>
            <span v-if="r.plate"> · {{ r.plate }}</span>
            <span v-if="r.territory"> · {{ r.territory }}</span>
            <span v-if="r.urgency" class="warn"> · {{ r.urgency }}</span>
          </div>
        </div>
      </div>
      <div class="imp-submit">
        <button class="primary block" style="min-height: 48px"
          :disabled="!customer || !rows.length || busy" @click="submit">
          <AppIcon name="upload" :size="18" />
          {{ busy ? 'Загрузка…' : `Создать заказ (${rows.length})` }}
        </button>
      </div>
    </div>

    <!-- загрузка файла -->
    <div v-else class="imp-file">
      <FileDropImport
        accept=".xlsx,.csv,.tsv"
        :disabled="!customer"
        :busy="busy"
        :warnings="warnings"
        :hint="!customer ? 'Сначала выберите заказчика — без него загрузка невозможна.' : ''"
        :max-size="20 * 1024 * 1024"
        @submit="submitFile"
      />
    </div>

    <RefPicker v-if="pick === 'customer'" dir="counterparties" title="Заказчик"
      @pick="v => { customer = v; contract = null; pick = null }" @close="pick = null" />
    <RefPicker v-if="pick === 'contract'" dir="contracts" :query="{ ownerId: customer.id }" title="Договор"
      @pick="v => { contract = v; pick = null }" @close="pick = null" />
  </section>
</template>

<style scoped>
.import { max-width: 900px; }

.imp-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 640px) { .imp-grid { grid-template-columns: 1fr 1fr; } }

/* ── Табы ───────────────────────────────────────────────── */
.imp-tabs {
  display: flex;
  align-items: flex-end;       /* действие прижимаем к правому краю по базовой линии */
  gap: 4px;
  margin: 16px 0 12px;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.imp-tabs::-webkit-scrollbar { display: none; }

.imp-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;         /* подчёркивание ложится на линию контейнера */
  background: transparent;
  color: var(--muted, inherit);
  font: inherit;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
  transition: color .15s, border-color .15s, background .15s;
}
.imp-tab:hover {
  color: var(--text, inherit);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.imp-tab.on {
  color: var(--accent);
  border-bottom-color: var(--accent);   /* явный индикатор активного таба */
  font-weight: 600;
}
.imp-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 6px 6px 0 0;
}

/* «Скачать шаблон» — действие в том же ряду, но визуально отдельно:
   прижато вправо, без подчёркивания-таба, в виде компактной кнопки. */
.imp-tab-action {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-bottom: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: inherit;
  font: inherit;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
}
.imp-tab-action:hover { border-color: var(--accent); color: var(--accent); }
.imp-tab-action:active { transform: translateY(1px); }
.imp-tab-action:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Остальное ──────────────────────────────────────────── */
.imp-rows {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
}
.imp-row {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.warn { color: var(--warn); }

.imp-submit {
  position: sticky;
  bottom: calc(var(--nav-h) + var(--safe-b) + 8px);
  padding-top: 8px;
}
@media (min-width: 900px) {
  .imp-submit { position: static; max-width: 320px; }
}



</style>