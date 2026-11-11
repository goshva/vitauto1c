<script setup>
// Неопознанные позиции (M18/A1/A2/K8, п. 2 «Сопоставление номенклатуры»):
// кладовщик создаёт позицию, менеджер привязывает её к номенклатуре или отмечает «найдено».
import { ref, computed, onMounted } from 'vue';
import { get, post } from '../api';
import { useToastStore } from '../stores/toast';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';

const toast = useToastStore();
const items = ref([]);
const loading = ref(false);
const q = ref('');

const createOpen = ref(false);
const createForm = ref({ factName: '', factArticle: '', lineId: '' });
const saving = ref(false);

const linkOpen = ref(false);
const linkItem = ref(null);
const linkQuery = ref('');
const linkResults = ref([]);
const linkLoading = ref(false);
const linkSaving = ref(false);

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return items.value;
  return items.value.filter(i =>
    (i.factName || '').toLowerCase().includes(s) ||
    (i.factArticle || '').toLowerCase().includes(s));
});

const openCount = computed(() => items.value.filter(i => !i.found && !i.nomenclatureId).length);

async function load() {
  loading.value = true;
  try { items.value = await get('/unidentified') || []; }
  catch (e) { toast.error(e); }
  finally { loading.value = false; }
}

function openCreate() {
  createForm.value = { factName: '', factArticle: '', lineId: '' };
  createOpen.value = true;
}

async function saveCreate() {
  if (!createForm.value.factName.trim() && !createForm.value.lineId.trim()) {
    toast.show('Укажите факт-наименование или строку заказа', 'error');
    return;
  }
  saving.value = true;
  try {
    await post('/unidentified', {
      factName: createForm.value.factName.trim(),
      lineId: createForm.value.lineId.trim()
    });
    toast.show('Неопознанная позиция создана', 'ok');
    createOpen.value = false;
    await load();
  } catch (e) { toast.error(e); }
  finally { saving.value = false; }
}

function openLink(item) {
  linkItem.value = item;
  linkQuery.value = item.factArticle || item.factName || '';
  linkResults.value = [];
  linkOpen.value = true;
  searchNomenclature();
}

async function searchNomenclature() {
  const s = linkQuery.value.trim();
  if (s.length < 2) { linkResults.value = []; return; }
  linkLoading.value = true;
  try {
    const res = await get('/catalog/goods', { q: s, limit: 20 });
    linkResults.value = (res && res.items) || [];
  } catch (e) { toast.error(e); }
  finally { linkLoading.value = false; }
}

async function doLink(nom) {
  linkSaving.value = true;
  try {
    await post(`/unidentified/${linkItem.value.id}/link`, { nomenclatureId: nom.id });
    toast.show(`Привязано к «${nom.name}»`, 'ok');
    linkOpen.value = false;
    await load();
  } catch (e) { toast.error(e); }
  finally { linkSaving.value = false; }
}

async function markFound(item) {
  if (!confirm(`Отметить позицию «${item.factName}» как найденную?`)) return;
  try {
    await post(`/unidentified/${item.id}/found`, {});
    toast.show('Отмечено как найдено', 'ok');
    await load();
  } catch (e) { toast.error(e); }
}

const d = v => (v ? String(v).slice(0, 16).replace('T', ' ') : '');
const sourceLabel = s => ({ line: 'строка заказа', stock: 'склад', workshop: 'цех' }[s] || s || '—');

onMounted(load);
</script>

<template>
  <section class="unidentified">
    <div class="chips">
      <button class="chip" :disabled="loading" @click="load"><AppIcon name="refresh" :size="14" /> Обновить</button>
      <button class="chip primary" @click="openCreate"><AppIcon name="plus" :size="14" /> Создать</button>
      <span class="chip muted">Не разобрано: {{ openCount }} из {{ items.length }}</span>
    </div>
    <div class="row" style="gap: 8px">
      <input v-model="q" class="grow" placeholder="Поиск по факт-наименованию или артикулу" />
    </div>

    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="!filtered.length" class="empty">
      <div class="big"><AppIcon name="box" :size="40" /></div>
      <div>{{ q ? 'Ничего не найдено' : 'Неопознанных позиций нет' }}</div>
      <div v-if="!q" class="muted small">Создание: кладовщик фиксирует позицию с фактическим наименованием и артикулом</div>
    </div>
    <div v-for="i in filtered" :key="i.id" class="card">
      <div class="row" style="gap: 8px">
        <div class="grow">
          <b>{{ i.factName || 'Без наименования' }}</b>
          <div class="muted small">
            <template v-if="i.factArticle">арт. {{ i.factArticle }} · </template>
            <template v-if="i.factQty">{{ i.factQty }} {{ i.factUnit }} · </template>
            {{ sourceLabel(i.source) }} · {{ d(i.createdAt) }}
          </div>
        </div>
        <span :class="['chip', i.nomenclatureId ? 'ok' : i.found ? 'warn' : 'danger']">
          {{ i.nomenclatureId ? 'привязано' : i.found ? 'найдено' : 'не разобрано' }}
        </span>
      </div>
      <div class="row" style="gap: 8px; margin-top: 6px">
        <button v-if="!i.nomenclatureId" class="primary small" :disabled="linkSaving" @click="openLink(i)">
          <AppIcon name="search" :size="14" /> Привязать к номенклатуре
        </button>
        <button v-if="!i.nomenclatureId && !i.found" class="small" @click="markFound(i)">
          <AppIcon name="check" :size="14" /> Найдено
        </button>
      </div>
      <div v-if="i.photoUrls && i.photoUrls.length" class="row" style="gap: 6px; margin-top: 6px; flex-wrap: wrap">
        <a v-for="(u, idx) in i.photoUrls" :key="idx" :href="u" target="_blank" rel="noopener" class="chip">фото {{ idx + 1 }}</a>
      </div>
    </div>

    <!-- Создание -->
    <AppModal v-if="createOpen" title="Новая неопознанная позиция" side @close="createOpen = false">
      <div class="muted small" style="margin-bottom: 8px">Достаточно факт-наименования или id строки заказа.</div>
      <label class="field">
        <span>Фактическое наименование</span>
        <input v-model="createForm.factName" placeholder="например, «Фильтр масляный, синий»" />
      </label>
      <label class="field">
        <span>Фактический артикул</span>
        <input v-model="createForm.factArticle" placeholder="например, W 914/2" />
      </label>
      <label class="field">
        <span>Id строки заказа (если есть)</span>
        <input v-model="createForm.lineId" placeholder="uuid строки" />
      </label>
      <template #actions>
        <button :disabled="saving" @click="createOpen = false">Отмена</button>
        <button class="primary" :disabled="saving" @click="saveCreate"><AppIcon name="check" :size="16" /> Создать</button>
      </template>
    </AppModal>

    <!-- Привязка к номенклатуре -->
    <AppModal v-if="linkOpen" title="Привязать к номенклатуре" side @close="linkOpen = false">
      <div class="muted small" style="margin-bottom: 8px">
        Позиция: <b>{{ linkItem && (linkItem.factName || linkItem.factArticle) }}</b>
        <template v-if="linkItem && linkItem.factQty"> · {{ linkItem.factQty }} {{ linkItem.factUnit }}</template>
      </div>
      <div class="row" style="gap: 6px">
        <input v-model="linkQuery" class="grow" placeholder="Название или артикул товара" @keyup.enter="searchNomenclature" />
        <button :disabled="linkLoading" @click="searchNomenclature"><AppIcon name="search" :size="16" /> Найти</button>
      </div>
      <div v-if="linkLoading" class="muted small">Поиск…</div>
      <div v-else-if="linkQuery.trim().length >= 2 && !linkResults.length" class="muted small">Ничего не найдено — уточните запрос.</div>
      <div v-for="n in linkResults" :key="n.id" class="row card" style="gap: 8px; margin-top: 6px">
        <div class="grow">
          <b>{{ n.name }}</b>
          <div class="muted small">
            <template v-if="n.article">арт. {{ n.article }} · </template>
            <template v-if="n.extCode">код поставщика {{ n.extCode }}</template>
          </div>
        </div>
        <button class="primary small" :disabled="linkSaving" @click="doLink(n)"><AppIcon name="check" :size="14" /> Привязать</button>
      </div>
      <template #actions><button @click="linkOpen = false">Закрыть</button></template>
    </AppModal>
  </section>
</template>

<style scoped>
.unidentified { display: flex; flex-direction: column; gap: 8px; }
.unidentified .card { display: flex; flex-direction: column; gap: 2px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.field span { font-size: 12px; color: var(--muted, #667); }
.field input { width: 100%; }
</style>
