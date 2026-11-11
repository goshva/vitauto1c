<script setup>
// Управление процессами (только администратор): интерактивная схема процессов
// из process.html (ТЗ × схема × матрица × код) + правила применения изменений.
const RULES = [
  ['Не влияют на незавершённые', 'Изменённый процесс не меняет уже запущенные экземпляры — они продолжают идти по своей версии.'],
  ['Могут наследоваться', 'Новая версия процесса наследует конфигурацию предыдущей; правки можно накапливать от версии к версии.'],
  ['Начинаются только с первого узла', 'Новый экземпляр берёт изменённую схему с самого начала — первый узел и далее.'],
  ['Не затрагивают начатое', 'К уже начатым процессам изменения не применяются задним числом.']
];
</script>

<template>
  <div class="process-view">
    <section class="notice" aria-label="Как применяются изменения процессов">
      <h3>Как применяются изменения процессов</h3>
      <ul>
        <li v-for="[head, text] in RULES" :key="head"><b>{{ head }}.</b> {{ text }}</li>
      </ul>
    </section>

    <div class="frame-head">
      <span class="muted">Интерактивная схема: ТЗ × схема × матрица × код</span>
      <a class="btn" href="/process.html" target="_blank" rel="noopener">Открыть в новой вкладке</a>
    </div>

    <iframe class="frame" src="/process.html" title="Управление процессами" loading="lazy"></iframe>
  </div>
</template>

<style scoped>
.process-view { display: flex; flex-direction: column; gap: 12px; }
.notice {
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent);
  background: var(--surface);
  border-radius: 12px;
  padding: 12px 16px;
}
.notice h3 { margin: 0 0 8px; font-size: 15px; }
.notice ul { margin: 0; padding-left: 18px; display: grid; gap: 5px; }
.notice li { font-size: 13px; color: var(--fg-2); line-height: 1.45; }
.notice b { color: var(--fg); }
.frame-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.frame-head .muted { font-size: 12px; }
.frame {
  width: 100%;
  height: calc(100dvh - 320px);
  min-height: 480px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
@media (max-width: 899px) {
  .frame { height: 72dvh; min-height: 360px; }
}
</style>
