<script setup>
import { ref, computed, watch } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  accept: { type: String, default: '.xlsx,.csv,.tsv' },
  // Внешние ограничения: можно ли грузить (заказчик выбран и т.п.)
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  // Текст кнопки; по умолчанию — с именем файла
  submitLabel: { type: String, default: '' },
  // Максимальный размер, байт (0 — без лимита)
  maxSize: { type: Number, default: 0 },
  warnings: { type: Array, default: () => [] },
  // Сообщение, почему нельзя грузить (показывается под инпутом)
  hint: { type: String, default: '' }
});
const emit = defineEmits(['submit', 'change']);

const file = ref(null);
const fileName = computed(() => (file.value ? file.value.name : ''));
const fileSize = computed(() => (file.value ? file.value.size : 0));
const dragging = ref(false);
const localError = ref('');

const hasFile = computed(() => !!file.value);
const sizeError = computed(() => {
  if (!file.value || !props.maxSize) return '';
  return file.value.size > props.maxSize
    ? `Файл больше ${(props.maxSize / 1024 / 1024).toFixed(1)} МБ`
    : '';
});
const canSubmit = computed(() => hasFile.value && !props.disabled && !props.busy && !sizeError.value);

const label = computed(() => {
  if (props.submitLabel) return props.submitLabel;
  return fileName.value ? `Загрузить ${fileName.value}` : 'Загрузить файл';
});

function humanSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

function pickFile(f) {
  localError.value = '';
  if (!f) { file.value = null; return; }
  const name = (f.name || '').toLowerCase();
  const extOk = props.accept.split(',').some(a => name.endsWith(a.trim().toLowerCase()));
  if (!extOk) {
    localError.value = `Неподдерживаемый формат. Ожидается: ${props.accept}`;
    file.value = null;
    return;
  }
  file.value = f;
  emit('change', f);
}

function onInput(e) {
  pickFile((e.target.files && e.target.files[0]) || null);
}

function onDrop(e) {
  dragging.value = false;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  pickFile(f || null);
}
function onDragOver(e) { e.preventDefault(); if (!props.busy) dragging.value = true; }
function onDragLeave() { dragging.value = false; }

function clear() { file.value = null; localError.value = ''; emit('change', null); }

function submit() {
  if (!canSubmit.value) return;
  emit('submit', file.value);
}

// при внешнем сбросе busy/disabled — не трогаем file, компонент управляется родителем
watch(() => props.disabled, v => { if (v) dragging.value = false; });
</script>

<template>
  <div class="fdi" :class="{ dragging, disabled: props.disabled || props.busy }">
    <label
      class="fdi-drop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      :aria-disabled="props.disabled || props.busy"
    >
      <input
        class="fdi-input"
        type="file"
        :accept="accept"
        :disabled="props.disabled || props.busy"
        @click="$event.target.value = ''"
        @change="onInput"
      />
      <span class="fdi-icon"><AppIcon name="upload" :size="22" /></span>
      <template v-if="hasFile">
        <b class="fdi-name">{{ fileName }}</b>
        <span class="muted small">{{ humanSize(fileSize) }}</span>
        <button type="button" class="fdi-clear" :disabled="props.busy" @click.prevent.stop="clear">Убрать</button>
      </template>
      <template v-else>
        <b>Перетащите файл сюда</b>
        <span class="muted small">или нажмите, чтобы выбрать ({{ accept.replaceAll(',', ' / ') }})</span>
      </template>
    </label>

    <p v-if="localError" class="err small" style="margin: 8px 0">{{ localError }}</p>
    <p v-else-if="sizeError" class="err small" style="margin: 8px 0">{{ sizeError }}</p>
    <p v-else-if="props.hint" class="err small" style="margin: 8px 0">{{ props.hint }}</p>
    <p v-if="props.warnings.length" class="err small" style="margin: 8px 0; white-space: pre-line">{{ props.warnings.join('\n') }}</p>

    <div class="fdi-submit">
      <button
        type="button"
        class="primary block"
        style="min-height: 48px"
        :disabled="!canSubmit"
        @click="submit"
      >
        <AppIcon name="upload" :size="18" />
        {{ props.busy ? 'Загрузка…' : label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fdi { display: flex; flex-direction: column; gap: 8px; }
.fdi-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 22px 16px;
  border: 1.5px dashed var(--line);
  border-radius: 14px;
  background: var(--surface);
  cursor: pointer;
  text-align: center;
  transition: border-color .15s, background .15s;
}
.fdi-drop:hover { border-color: var(--accent); }
.fdi.dragging .fdi-drop { border-color: var(--accent); background: var(--accent-soft, rgba(0,0,0,.03)); }
.fdi.disabled .fdi-drop { opacity: .6; cursor: not-allowed; }
.fdi-input { position: absolute; inset: 0; opacity: 0; cursor: inherit; }
.fdi-icon { display: inline-flex; align-items: center; justify-content: center; }
.fdi-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fdi-clear {
  margin-top: 4px; font-size: 12px; padding: 4px 10px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface); cursor: pointer;
}
.fdi-submit { padding-top: 4px; }
.fdi-submit .primary { width: 100%; }
</style>