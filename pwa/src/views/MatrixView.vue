<script setup>
// Матрица роли из GET /matrix: колонка × статус, символ маски (+ можно, c автор, . нельзя).
import { onMounted, ref } from 'vue';
import { useMatrixStore } from '../stores/matrix';
import { useSessionStore } from '../stores/session';
import { STATUS_TITLES } from '../lib/columns';

const matrix = useMatrixStore();
const session = useSessionStore();
const error = ref('');
const onlyWritable = ref(false);

async function load() {
  error.value = '';
  try { await matrix.load(session.role); } catch (e) { error.value = `${e.code}: ${e.message}`; }
}
onMounted(load);
const CLS = { '+': 'ok', c: 'warn', '.': '' };
</script>

<template>
  <section class="col">
    <div class="row">
      <h1 style="margin: 0">Матрица роли {{ matrix.role }}</h1>
      <span class="muted">ETag {{ matrix.etag }} · {{ matrix.columns.length }} колонок</span>
      <label><input type="checkbox" v-model="onlyWritable" /> только записываемые</label>
      <button @click="load">Обновить (If-None-Match)</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="sticky-1">Колонка</th><th>Поле</th><th>Тип</th>
            <th v-for="s in matrix.statuses" :key="s" :title="s">{{ STATUS_TITLES[s] || s }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in matrix.columns.filter(c => !onlyWritable || c.writable)" :key="c.id">
            <td class="sticky-1"><b style="color: var(--accent)">{{ c.code }}</b> {{ c.title }}</td>
            <td class="muted">{{ c.field }}{{ c.writable ? '' : ' (чтение)' }}</td>
            <td class="muted">{{ c.dataType }}</td>
            <td v-for="(s, i) in matrix.statuses" :key="s" style="text-align: center">
              <span :class="['chip', CLS[c.rights[i]]]">{{ c.rights[i] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
