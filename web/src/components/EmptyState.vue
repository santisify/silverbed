<script setup lang="ts">
defineProps<{ title: string; body?: string; compact?: boolean }>();
</script>

<template>
  <div
    class="sheet-grid flex flex-col items-center justify-center gap-2 border text-center"
    :class="compact ? 'px-4 py-8' : 'px-6 py-20'"
  >
    <div class="mb-1 h-8 w-12 border border-rule-strong">
      <div class="mx-auto mt-1 h-4 w-4 rounded-full border border-safelight"></div>
    </div>
    <p class="text-title">{{ title }}</p>
    <p v-if="body" class="max-w-md text-label text-ink-2">{{ body }}</p>
    <div class="mt-2"><slot /></div>
  </div>
</template>
