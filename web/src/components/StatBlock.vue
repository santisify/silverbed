<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string; accent?: boolean }>();
</script>

<template>
  <div class="border-r px-4 py-3 last:border-r-0">
    <p class="label">{{ label }}</p>
    <p class="num mt-2 text-display" :style="accent ? 'color: var(--safelight)' : ''">{{ value }}</p>
    <p v-if="hint" class="mt-1 font-mono text-micro text-ink-3">{{ hint }}</p>
  </div>
</template>
