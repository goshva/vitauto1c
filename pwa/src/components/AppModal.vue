<script setup>
// Лист снизу на телефоне, диалог по центру на ПК; side — боковая панель справа на ПК.
import { onMounted, onBeforeUnmount, ref } from 'vue';
import AppIcon from './AppIcon.vue';

defineProps({ title: String, side: Boolean, wide: Boolean });
const emit = defineEmits(['close']);
const box = ref(null);
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  const el = box.value && box.value.querySelector('[autofocus]');
  if (el) el.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  // этот лист ещё в DOM: прокрутку возвращаем, только если он последний
  if (document.querySelectorAll('.modal-back').length <= 1) document.body.style.overflow = '';
});
</script>

<template>
  <div :class="['modal-back', { side }]" @click.self="emit('close')">
    <div ref="box" :class="['modal', { wide }]" role="dialog" aria-modal="true" :aria-label="title">
      <div class="modal-head">
        <h2>{{ title }}</h2>
        <slot name="head" />
        <button class="icon" aria-label="Закрыть" title="Закрыть" @click="emit('close')"><AppIcon name="x" /></button>
      </div>
      <slot />
      <div class="actions"><slot name="actions"><button @click="emit('close')">Закрыть</button></slot></div>
    </div>
  </div>
</template>
