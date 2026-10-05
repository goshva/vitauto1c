<script setup>
defineProps({ title: String });
const emit = defineEmits(['close']);
</script>

<template>
  <div class="modal-back" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="modal" role="dialog" :aria-label="title">
      <h2>{{ title }}</h2>
      <slot />
      <div class="actions"><slot name="actions"><button @click="emit('close')">Закрыть</button></slot></div>
    </div>
  </div>
</template>
