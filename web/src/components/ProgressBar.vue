<script setup lang="ts">
defineProps<{ value: number; tone?: "ink" | "safelight" | "kept" }>();
</script>

<template>
  <div class="h-[3px] w-full" style="background: var(--paper-3)">
    <div
      class="h-full transition-[width] duration-200"
      :style="{
        width: `${Math.min(100, Math.max(0, value))}%`,
        background: tone === 'safelight' ? 'var(--safelight)' : tone === 'kept' ? 'var(--kept)' : 'var(--ink)',
      }"
    />
  </div>
</template>
