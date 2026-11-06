<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ values: number[]; height?: number; accentLast?: boolean; label?: string }>(),
  { height: 44, accentLast: true },
);

const bars = computed(() => {
  const max = Math.max(1, ...props.values);
  return props.values.map((value, index) => ({
    height: Math.max(2, Math.round((value / max) * 100)),
    value,
    last: index === props.values.length - 1,
  }));
});
</script>

<template>
  <div>
    <div class="flex items-end gap-[2px]" :style="{ height: `${height}px` }" role="img" :aria-label="label">
      <div
        v-for="(bar, index) in bars"
        :key="index"
        class="flex-1 transition-colors"
        :style="{
          height: `${bar.height}%`,
          background: bar.last && accentLast ? 'var(--safelight)' : 'var(--rule-strong)',
        }"
        :title="`${bar.value}`"
      />
    </div>
  </div>
</template>
