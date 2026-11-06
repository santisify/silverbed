<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{ title: string; width?: string }>();
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKey);
  panel.value?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
});
onUnmounted(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh]" @click.self="emit('close')">
    <div ref="panel" class="fade-in w-full border bg-paper shadow-frame" :style="{ maxWidth: width ?? '30rem' }">
      <header class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-title">{{ props.title }}</h2>
        <button class="btn btn-ghost h-7 px-2" @click="emit('close')">✕</button>
      </header>
      <div class="px-4 py-4">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t px-4 py-3">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
