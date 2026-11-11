<script setup>
// Настройки прав групп пользователей: роль = группа. Матрица полей по статусам, процессы и
// узлы process.html, CRUD-права справочников и каталога. Источник — GET /settings/groups
// (matrix.json + process-presets.json, собранные из index.html/process.html/questionnaire.html).
import { computed, onMounted, ref, watch } from 'vue';
import { api, get } from '../api';
import { STATUS_TITLES } from '../lib/columns';
import { useSessionStore } from '../stores/session';
import { useToastStore } from '../stores/toast';

const session = useSessionStore();
const toast = useToastStore();
const data = ref(null);
const active = ref('');
const error = ref('');
const loading = ref(false);
const onlyWritable = ref(false);
const draft = ref(null); // редактируемая копия матрицы активной группы
const saving = ref(false);

const CLS = { '+': 'ok', c: 'warn', '.': '' };
const CYCLE = ['.', '+', 'c'];
const isAdmin = computed(() => session.role === 'admin');
const editable = computed(() => isAdmin.value && !!draft.value);
const group = computed(() => data.value?.groups.find(g => g.role === active.value) || null);
const columns = computed(() => {
  const src = draft.value ? draft.value.columns : (group.value ? group.value.matrix : []);
  return src.filter(c => !onlyWritable.value || c.writable);
});
const dirty = computed(() => {
  const g = group.value, d = draft.value;
  if (!g || !d) return false;
  return d.columns.some((c, i) => c.rights !== g.matrix[i].rights);
});

// Права ячейки по кругу: . → + → c → . («+» можно, «c» только автор, «.» нельзя)
function cycle(c, i) {
  if (!editable.value) return;
  const cur = c.rights[i] || '.';
  const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
  c.rights = c.rights.slice(0, i) + next + c.rights.slice(i + 1);
}
function resetDraft() {
  const g = group.value;
  draft.value = g ? { role: g.role, columns: g.matrix.map(c => ({ ...c })) } : null;
}
watch([active, data], resetDraft, { immediate: true });

async function save() {
  if (!draft.value || saving.value) return;
  saving.value = true;
  try {
    await api('PUT', `/settings/groups/${draft.value.role}/matrix`, { body: { columns: draft.value.columns } });
    toast.show('Матрица сохранена в matrix.json — применено сразу, без пересборки', 'ok');
    await load();
  } catch (e) {
    toast.error(e);
  } finally {
    saving.value = false;
  }
}

// Заголовок колонки матрицы по id — чтобы в узлах процесса показывать права, а не сырые id.
const titles = computed(() => {
  const map = {};
  for (const c of data.value?.columns || []) map[c.id] = c;
  for (const g of data.value?.groups || []) for (const c of g.matrix) map[c.id] = c;
  if (draft.value) for (const c of draft.value.columns) map[c.id] = c; // черновик важнее сохранённого
  return map;
});
const columnTitle = id => {
  const c = titles.value[id];
  return c ? `${c.code} ${c.title}` : id;
};
const rightsSummary = id => {
  const c = titles.value[id];
  if (!c) return '';
  const mask = c.rights || '';
  const yes = [];
  for (let i = 0; i < mask.length && i < (data.value?.statuses || []).length; i++) {
    if (mask[i] !== '.') yes.push(STATUS_TITLES[data.value.statuses[i]] || data.value.statuses[i]);
  }
  return yes.join(', ');
};
const nodeColumns = n => (n.columns || []).map(columnTitle);
const crudTitle = c => `${c.title} (${c.entity})`;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await get('/settings/groups');
    if (!active.value || !data.value.groups.some(g => g.role === active.value)) {
      active.value = data.value.groups[0]?.role || '';
    }
  } catch (e) {
    error.value = `${e.code}: ${e.message}`;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="col">
    <div class="row">
      <b>Настройки прав групп пользователей</b>
      <span v-if="data" class="muted">{{ data.source }} · {{ data.groups.length }} групп · {{ data.statuses.length }} статусов</span>
      <span class="grow"></span>
      <label class="chip"><input type="checkbox" v-model="onlyWritable" /> только записываемые</label>
      <button @click="load">Обновить</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading" class="muted">Загрузка…</p>

    <template v-if="data">
      <div class="roles-tabs" role="tablist" aria-label="Группы пользователей">
        <button v-for="g in data.groups" :key="g.role" role="tab" :aria-selected="g.role === active"
                :class="{ active: g.role === active }" @click="active = g.role">
          {{ g.title }} <span class="muted">({{ g.role }})</span>
        </button>
      </div>

      <template v-if="group">
        <div class="row">
          <b>{{ group.title }}</b>
          <span class="muted">{{ group.role }} · {{ group.matrix.length }} колонок · {{ group.processes.length }} узлов · {{ group.crud.length }} CRUD</span>
          <span class="grow"></span>
          <span class="chip info">{{ session.role === 'admin' ? 'администратор' : 'просмотр' }}</span>
        </div>

        <h3>Матрица прав по статусам</h3>
        <p class="muted small">
          Клик по ячейке переключает право: <b>+</b> можно, <b>c</b> только автор строки, <b>.</b> нельзя.
          Изменения пишутся в <code>matrix.json</code> и применяются сразу (hot-reload), без пересборки;
          на незавершённые процессы не влияют.
        </p>
        <div v-if="isAdmin" class="row">
          <span class="muted small">{{ dirty ? 'Есть несохранённые правки' : 'Правок нет' }}</span>
          <span class="grow"></span>
          <button v-if="dirty" :disabled="saving" @click="resetDraft">Отменить</button>
          <button class="primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить матрицу' }}</button>
        </div>
        <p v-else class="muted small">Режим просмотра: менять матрицу может только администратор.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="sticky-1">Колонка</th>
                <th>Поле</th>
                <th>Тип</th>
                <th v-for="s in data.statuses" :key="s" :title="s">{{ STATUS_TITLES[s] || s }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in columns" :key="c.id">
                <td class="sticky-1"><b style="color: var(--accent)">{{ c.code }}</b> {{ c.title }}</td>
                <td class="muted">{{ c.field }}{{ c.writable ? '' : ' (чтение)' }}</td>
                <td class="muted">{{ c.dataType }}</td>
                <td v-for="(s, i) in data.statuses" :key="s" style="text-align: center">
                  <button type="button" class="chip cell" :class="[CLS[c.rights[i]], { editable }]"
                          :disabled="!editable" :title="editable ? 'Клик: . → + → c' : 'Меняет только администратор'"
                          @click="cycle(c, i)">{{ c.rights[i] }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Процессы и узлы группы</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Узел</th><th>Название</th><th>Статусы</th><th>Колонки матрицы (права)</th></tr>
            </thead>
            <tbody>
              <tr v-for="n in group.processes" :key="n.id">
                <td><b style="color: var(--accent)">{{ n.id }}</b></td>
                <td>{{ n.title }}</td>
                <td class="muted">{{ n.statuses.length ? n.statuses.map(s => STATUS_TITLES[s] || s).join(', ') : '—' }}</td>
                <td>
                  <span v-for="c in n.columns" :key="c" class="chip" :title="rightsSummary(c)">{{ columnTitle(c) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Связь прав и CRUD с узлами</h3>
        <p class="muted">CRUD-права группы на справочники и каталог; связь с процессами и узлами — через колонки матрицы, которые видны и правятся на узлах.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Сущность</th><th>Название</th><th>Операции</th><th>Узлы группы</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in group.crud" :key="c.entity + '/' + c.name">
                <td>{{ c.entity }}</td>
                <td>{{ c.title }}</td>
                <td><span v-for="op in c.operations" :key="op" class="chip ok">{{ op }}</span></td>
                <td class="muted">{{ group.processes.map(n => n.id).join(', ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.roles-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.roles-tabs button { padding: 7px 12px; border-radius: 6px 6px 0 0; border: 1px solid var(--line); border-bottom: none; background: var(--surface); color: var(--fg-2); font-weight: 600; }
.roles-tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
/* ячейка матрицы: компактная кнопка вместо крупной глобальной кнопки */
td .cell { min-height: 0; height: 22px; padding: 0 8px; font-size: 12px; font-weight: 700; border-radius: 999px; }
td .cell.editable { cursor: pointer; }
td .cell.editable:hover { border-color: var(--accent); }
td .cell:disabled { opacity: 1; cursor: default; }
</style>
