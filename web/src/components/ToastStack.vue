<script setup lang="ts">
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(24rem,92vw)] flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-3 border bg-paper px-3 py-2 shadow-frame"
        :style="{ borderColor: toast.kind === 'error' ? 'var(--safelight)' : 'var(--rule-strong)' }"
      >
        <span
          class="mt-[3px] h-2 w-2 shrink-0 rounded-full"
          :style="{ background: toast.kind === 'error' ? 'var(--safelight)' : toast.kind === 'success' ? 'var(--kept)' : 'var(--ink-3)' }"
        />
        <div class="min-w-0 flex-1">
          <p class="text-label">{{ toast.message }}</p>
          <p v-if="toast.detail" class="mt-0.5 font-mono text-micro text-ink-3">{{ toast.detail }}</p>
        </div>
        <button class="font-mono text-micro text-ink-3 hover:text-ink" @click="ui.dismiss(toast.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
