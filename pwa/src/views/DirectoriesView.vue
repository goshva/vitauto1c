<script setup>
// Раздел «Справочники»: списки с поиском и правкой.
// CRUD (создание, изменение, пометка удаления и возврат) доступен только администратору:
// поля справочника описаны в DIRS, запросы — POST/PATCH/DELETE /directories/{name}[/{id}].
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get, post, patch, del } from '../api';
import { useSessionStore } from '../stores/session';
import { useToastStore } from '../stores/toast';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();

const DIRS = {
  counterparties: {
    title: 'Контрагенты', search: true,
    fields: [
      { k: 'name', label: 'Наименование', required: true },
      { k: 'fullName', label: 'Полное наименование' },
      { k: 'inn', label: 'ИНН' },
      { k: 'kpp', label: 'КПП' },
      { k: 'comment', label: 'Комментарий', type: 'textarea' },
      { k: 'isCustomer', label: 'Покупатель', type: 'bool' },
      { k: 'isSupplier', label: 'Поставщик', type: 'bool' },
      { k: 'inactive', label: 'Недействителен', type: 'bool' }
    ]
  },
  contracts: {
    title: 'Договоры', owner: true,
    fields: [
      { k: 'name', label: 'Наименование', required: true },
      { k: 'counterpartyId', label: 'Контрагент', type: 'ref', dir: 'counterparties', required: true },
      { k: 'contractNo', label: 'Номер договора' },
      { k: 'contractDate', label: 'Дата договора', type: 'date' },
      { k: 'comment', label: 'Комментарий', type: 'textarea' },
      { k: 'inactive', label: 'Недействителен', type: 'bool' }
    ]
  },
  nomenclature: { title: 'Номенклатура', search: true, required: true },
  batches: { title: 'Партии', nomenclature: true },
  'service-types': {
    title: 'Виды услуг',
    fields: [
      { k: 'code', label: 'Код' },
      { k: 'name', label: 'Наименование', required: true }
    ]
  },
  'payment-forms': {
    title: 'Формы оплаты',
    fields: [
      { k: 'code', label: 'Код' },
      { k: 'name', label: 'Наименование', required: true }
    ]
  },
  units: {
    title: 'Единицы',
    fields: [
      { k: 'name', label: 'Наименование', required: true },
      { k: 'code', label: 'Код' },
      { k: 'fullName', label: 'Полное наименование' },
      { k: 'intlCode', label: 'Международное сокращение' }
    ]
  },
  warehouses: {
    title: 'Склады',
    fields: [
      { k: 'name', label: 'Наименование', required: true },
      { k: 'code', label: 'Код' },
      { k: 'unitType', label: 'Тип структурной единицы' },
      { k: 'isWarehouse', label: 'Это склад', type: 'bool' },
      { k: 'isMain', label: 'Основной склад', type: 'bool' },
      { k: 'orderBased', label: 'Ордерный склад', type: 'bool' }
    ]
  },
  cells: {
    title: 'Ячейки', warehouse: true,
    fields: [
      { k: 'code', label: 'Код ячейки', required: true },
      { k: 'warehouseId', label: 'Склад', type: 'ref', dir: 'warehouses', required: true },
      { k: 'zoneId', label: 'Зона склада', type: 'ref', dir: 'zones' },
      { k: 'capacity', label: 'Вместимость', type: 'number' },
      { k: 'blocked', label: 'Заблокирована', type: 'bool' }
    ]
  },
  zones: {
    title: 'Зоны склада',
    fields: [
      { k: 'code', label: 'Код', required: true },
      { k: 'name', label: 'Наименование', required: true },
      { k: 'purpose', label: 'Назначение' },
      { k: 'sort', label: 'Порядок', type: 'int' }
    ]
  }
};

const name = computed(() => (DIRS[route.params.name] ? route.params.name : 'counterparties'));
const dir = computed(() => DIRS[name.value]);
const canEdit = computed(() => session.role === 'admin' && !!dir.value.fields);
const q = ref('');
const ownerId = ref('');
const nomenclatureId = ref('');
const warehouseId = ref('');
const showDeleted = ref(false);
const items = ref([]);
const error = ref('');
const loading = ref(false);

// Справочники для выпадающих списков формы: контрагенты, склады, зоны.
const refs = ref({ counterparties: [], warehouses: [], zones: [] });
// Карточка правки (объявлена до watch с immediate: true — он её сбрасывает).
const form = ref(null);   // { id, values, error }
const busy = ref(false);
async function ensureRefs(d) {
  const need = [...new Set((d.fields || []).filter(f => f.type === 'ref').map(f => f.dir))];
  for (const r of need) {
    if (!refs.value[r].length) {
      try { refs.value[r] = await get('/directories/' + r); } catch (e) { toast.error(e); }
    }
  }
  if (d.warehouse && !refs.value.warehouses.length) {
    try { refs.value.warehouses = await get('/directories/warehouses'); } catch (e) { toast.error(e); }
  }
  if (d.warehouse && !warehouseId.value) {
    const main = refs.value.warehouses.find(w => w.isMain) || refs.value.warehouses[0];
    if (main) warehouseId.value = main.id;
  }
}

async function load() {
  const d = dir.value;
  error.value = '';
  if (d.required && !q.value.trim()) { items.value = []; return; }
  if (d.warehouse) await ensureRefs(d);
  loading.value = true;
  try {
    items.value = await get('/directories/' + name.value, {
      q: d.search ? q.value.trim() : undefined,
      ownerId: d.owner ? ownerId.value : undefined,
      nomenclatureId: d.nomenclature ? nomenclatureId.value : undefined,
      warehouseId: d.warehouse ? warehouseId.value : undefined,
      deleted: showDeleted.value && canEdit.value ? 'true' : undefined
    });
  } catch (e) {
    items.value = [];
    error.value = `${e.status} ${e.code}: ${e.message}`;
  } finally {
    loading.value = false;
  }
}
watch(name, () => { q.value = ''; warehouseId.value = ''; showDeleted.value = false; form.value = null; load(); }, { immediate: true });
let timer;
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300); });

const extra = it => Object.entries(it).filter(([k, v]) => !['id', 'name', 'deleted'].includes(k) && v !== '' && v != null && v !== false);
function useAsOwner(it) {
  if (name.value === 'counterparties') { ownerId.value = it.id; router.push('/directories/contracts'); }
  if (name.value === 'nomenclature') { nomenclatureId.value = it.id; router.push('/directories/batches'); }
}
function pickOwner(id) { ownerId.value = id; load(); }

// ---------- карточка правки ----------
async function openForm(it) {
  const d = dir.value;
  await ensureRefs(d);
  const values = {};
  for (const f of d.fields) {
    const v = it ? it[f.k] : (f.type === 'bool' ? false : '');
    values[f.k] = v == null ? '' : v;
  }
  if (!it && name.value === 'contracts' && ownerId.value) values.counterpartyId = ownerId.value;
  if (!it && name.value === 'cells' && warehouseId.value) values.warehouseId = warehouseId.value;
  form.value = { id: it ? it.id : null, values, error: '' };
}

async function save() {
  const d = dir.value;
  const body = {};
  for (const f of d.fields) {
    const v = form.value.values[f.k];
    if (f.type === 'bool') body[f.k] = !!v;
    else if (f.type === 'number' || f.type === 'int') body[f.k] = v === '' || v == null ? '' : String(v);
    else body[f.k] = v == null ? '' : String(v);
  }
  busy.value = true;
  try {
    if (form.value.id) await patch(`/directories/${name.value}/${form.value.id}`, body);
    else await post(`/directories/${name.value}`, body);
    toast.show('Сохранено', 'ok');
    form.value = null;
    await load();
  } catch (e) {
    form.value.error = `${e.status} ${e.code}: ${e.message}${e.field ? ` (${e.field})` : ''}`;
    toast.error(e);
  } finally {
    busy.value = false;
  }
}

async function remove(it) {
  const label = it.name || it.code || it.id;
  if (!confirm(`Пометить на удаление: ${label}?`)) return;
  try {
    await del(`/directories/${name.value}/${it.id}`);
    toast.show('Помечено на удаление', 'ok');
    await load();
  } catch (e) { toast.error(e); }
}

async function restore(it) {
  try {
    await post(`/directories/${name.value}/${it.id}/restore`);
    toast.show('Восстановлено', 'ok');
    await load();
  } catch (e) { toast.error(e); }
}
</script>

<template>
  <section class="page">
    <div class="chips" role="tablist" aria-label="Справочник">
      <RouterLink v-for="(d, k) in DIRS" :key="k" :to="'/directories/' + k" role="tab" :aria-selected="k === name"
                  :class="['btn', 'chip', { on: k === name }]">{{ d.title }}</RouterLink>
    </div>
    <div class="row">
      <div v-if="dir.search" class="search"><span class="ico"><AppIcon name="search" :size="18" /></span>
        <input v-model="q" type="search" :placeholder="dir.required ? 'Наименование, артикул или код' : 'Поиск'" /></div>
      <label v-if="dir.owner" class="field grow">Контрагент
        <select :value="ownerId" @change="pickOwner($event.target.value)">
          <option value="">— выберите контрагента —</option>
          <option v-for="c in refs.counterparties" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label v-if="dir.warehouse" class="field grow">Склад
        <select v-model="warehouseId" @change="load">
          <option value="">Все склады</option>
          <option v-for="w in refs.warehouses" :key="w.id" :value="w.id">{{ w.name }}<template v-if="w.isMain"> · основной</template></option>
        </select>
      </label>
      <label v-if="dir.nomenclature" class="field grow">Номенклатура (uuid) <input v-model="nomenclatureId" placeholder="выберите в «Номенклатуре» → партии" /></label>
      <label v-if="canEdit" class="field"><input type="checkbox" v-model="showDeleted" @change="load" /> удалённые</label>
      <button v-if="canEdit" class="primary" @click="openForm(null)"><AppIcon name="plus" :size="18" /> Добавить</button>
      <button class="icon" aria-label="Обновить" @click="load" :disabled="loading"><AppIcon name="refresh" /></button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="muted small">{{ loading ? 'Загрузка…' : `Найдено: ${items.length}` }}<template v-if="canEdit"> · правка доступна администратору</template></div>
    <div v-if="dir.required && !q" class="empty"><div class="big"><AppIcon name="search" :size="40" /></div>Номенклатура ищется по строке</div>
    <div v-else-if="dir.owner && !ownerId" class="empty"><div class="big"><AppIcon name="book" :size="40" /></div>Выберите контрагента — договоры вложены в него</div>
    <div v-else class="list" style="max-height: none">
      <div v-for="it in items" :key="it.id" class="item dir-item" :class="{ faint: it.deleted }">
        <div class="grow">
          <div>{{ it.name || it.code }}<span v-if="it.deleted" class="chip err">удалён</span></div>
          <div class="faint small"><span v-for="[k, v] in extra(it)" :key="k">{{ k }}: {{ v }} · </span><span>{{ it.id }}</span></div>
        </div>
        <button v-if="name === 'counterparties'" class="sm tonal" @click="useAsOwner(it)">Договоры</button>
        <button v-if="name === 'nomenclature'" class="sm tonal" @click="useAsOwner(it)">Партии</button>
        <template v-if="canEdit && dir.fields">
          <template v-if="it.deleted">
            <button class="sm tonal" @click="restore(it)">Вернуть</button>
          </template>
          <template v-else>
            <button class="sm tonal" @click="openForm(it)">Изменить</button>
            <button class="sm danger" @click="remove(it)">Удалить</button>
          </template>
        </template>
      </div>
      <div v-if="!items.length && !loading" class="item muted">Пусто</div>
    </div>

    <AppModal v-if="form" :title="(form.id ? 'Изменить: ' : 'Новый элемент: ') + dir.title" @close="form = null">
      <p v-if="form.error" class="err">{{ form.error }}</p>
      <label v-for="f in dir.fields" :key="f.k" class="field">
        {{ f.label }}<template v-if="f.required"> *</template>
        <textarea v-if="f.type === 'textarea'" v-model="form.values[f.k]" rows="3"></textarea>
        <select v-else-if="f.type === 'ref'" v-model="form.values[f.k]">
          <option value="">— не выбрано —</option>
          <option v-for="o in refs[f.dir]" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <input v-else-if="f.type === 'bool'" type="checkbox" v-model="form.values[f.k]" />
        <input v-else-if="f.type === 'date'" type="date" v-model="form.values[f.k]" />
        <input v-else-if="f.type === 'number' || f.type === 'int'" type="number" :step="f.type === 'int' ? 1 : 'any'" v-model="form.values[f.k]" />
        <input v-else v-model="form.values[f.k]" />
      </label>
      <template #actions>
        <button @click="form = null">Отмена</button>
        <button class="primary" :disabled="busy" @click="save">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.dir-item { cursor: default; }
.dir-item:hover { background: none; }
.dir-item .small { overflow-wrap: anywhere; }
.dir-item .chip { margin-left: 8px; }
</style>
