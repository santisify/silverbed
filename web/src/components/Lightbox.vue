<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import type { ImageFile } from "@/api";
import { useI18n } from "@/i18n";

const props = defineProps<{ files: ImageFile[]; index: number }>();
const emit = defineEmits<{ close: []; navigate: [index: number] }>();
const { t } = useI18n();

const current = computed(() => props.files[props.index] ?? null);

function step(delta: number) {
  const next = (props.index + delta + props.files.length) % props.files.length;
  emit("navigate", next);
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
  if (event.key === "ArrowRight") step(1);
  if (event.key === "ArrowLeft") step(-1);
}

onMounted(() => document.addEventListener("keydown", onKey));
onUnmounted(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="current" class="fixed inset-0 z-[75] flex flex-col bg-black/92 text-white" @click.self="emit('close')">
    <header class="flex items-center justify-between px-4 py-3 text-[13px]">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-[11px] uppercase tracking-wide text-white/50">{{ index + 1 }} / {{ files.length }}</span>
        <span class="truncate">{{ current.name }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[11px] text-white/50">{{ current.width }}×{{ current.height }} · {{ current.sizeHuman }}</span>
        <button class="border border-white/25 px-2 py-1 font-mono text-[11px]" @click="emit('close')">ESC</button>
      </div>
    </header>
    <div class="relative flex flex-1 items-center justify-center overflow-hidden px-4" @click.self="emit('close')">
      <button class="absolute left-2 z-10 h-10 w-10 border border-white/20 font-mono hover:bg-white/10" @click="step(-1)">←</button>
      <img :src="`/i/${current.id}.${current.ext}`" :alt="current.name" class="max-h-full max-w-full object-contain" />
      <button class="absolute right-2 z-10 h-10 w-10 border border-white/20 font-mono hover:bg-white/10" @click="step(1)">→</button>
    </div>
    <footer class="flex items-center justify-center gap-4 px-4 py-3 font-mono text-[11px] text-white/60">
      <a :href="`/i/${current.id}.${current.ext}`" target="_blank" class="hover:text-white">{{ t("library.direct") }}</a>
      <span>{{ current.tags.map((tag) => tag.name).join(" · ") || "—" }}</span>
    </footer>
  </div>
</template>
