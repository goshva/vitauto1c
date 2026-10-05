<script setup>
import { ref } from 'vue';
import { useLogStore } from '../stores/log';

const log = useLogStore();
const open = ref(null);
const onlyErrors = ref(false);
const cls = s => (s === 0 || s >= 500 ? 'err' : s >= 400 ? 'warn' : 'ok');
</script>

<template>
  <section class="col">
    <div class="row">
      <h1 style="margin: 0">Журнал запросов</h1>
      <label><input type="checkbox" v-model="onlyErrors" /> только ошибки</label>
      <button @click="log.clear()">Очистить</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Время</th><th>Метод</th><th>URL</th><th>Код</th><th>мс</th></tr></thead>
        <tbody>
          <template v-for="e in log.entries.filter(e => !onlyErrors || e.status === 0 || e.status >= 400)" :key="e.id">
            <tr @click="open = open === e.id ? null : e.id" style="cursor: pointer">
              <td>{{ e.at.toLocaleTimeString() }}</td>
              <td><b>{{ e.method }}</b></td>
              <td>{{ e.url }}</td>
              <td><span :class="['chip', cls(e.status)]">{{ e.status }}</span></td>
              <td class="num">{{ e.ms }}</td>
            </tr>
            <tr v-if="open === e.id">
              <td colspan="5" style="white-space: normal; max-width: none">
                <div v-if="e.request !== undefined"><b>Запрос</b><pre>{{ JSON.stringify(e.request, null, 2) }}</pre></div>
                <div><b>Ответ</b><pre>{{ typeof e.response === 'string' ? e.response : JSON.stringify(e.response, null, 2) }}</pre></div>
              </td>
            </tr>
          </template>
          <tr v-if="!log.entries.length"><td colspan="5" class="muted">Запросов ещё не было</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
