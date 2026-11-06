<script setup lang="ts">
import { computed } from "vue";
import type { ImageFile } from "@/api";

const props = withDefaults(
  defineProps<{
    file: ImageFile;
    selected: boolean;
    focused: boolean;
    index: number;
    layout?: "sheet" | "grid" | "list";
    /** Shared sheets show a checkbox only on frames the viewer may manage. */
    selectable?: boolean;
    /** Uploader handle, shown on the shared sheet. */
    owner?: string | null;
    /** Packed tile width; unset means the tile fills its grid cell. */
    width?: number | null;
  }>(),
  { layout: "sheet", selectable: true, owner: null, width: null },
);
const emit = defineEmits<{ select: [event: MouseEvent]; focus: []; open: [] }>();

const ratio = computed(() => {
  if (!props.file.width || !props.file.height) return "1 / 1";
  return `${props.file.width} / ${props.file.height}`;
});

const thumb = computed(() => `/i/${props.file.id}.thumb.webp`);

/** Trashed frames are not served by /i/ at all, so show a tear-off strip instead of a broken image. */
const trashed = computed(() => Boolean(props.file.deletedAt));

const markClass = computed(() => (props.file.accessLevel === "private" ? "border-safelight" : "border-transparent"));
</script>

<template>
  <article
    v-if="layout !== 'list'"
    class="group relative shrink-0 cursor-pointer overflow-hidden border-b border-r bg-paper p-2 transition-colors"
    :style="{ width: width ? `${width}px` : undefined, ...(focused ? { background: 'var(--paper-2)' } : {}) }"
    @click="emit('focus')"
    @dblclick="emit('open')"
  >
    <div class="relative w-full overflow-hidden" :style="{ aspectRatio: ratio, background: 'var(--paper-2)' }">
      <img
        v-if="!trashed"
        :src="thumb"
        :alt="file.name"
        loading="lazy"
        decoding="async"
        class="h-full w-full object-contain transition-opacity"
        :style="selected ? 'opacity:0.86' : ''"
      />
      <div v-else class="flex h-full w-full items-center justify-center" style="background: var(--paper-3)">
        <span class="font-mono text-micro uppercase text-ink-3">{{ file.status === "trashed" ? "trash" : "—" }}</span>
      </div>
      <div class="pointer-events-none absolute inset-0 border" :class="focused ? 'border-ink' : 'border-transparent'" />
      <div
        class="pointer-events-none absolute inset-1 border-2 transition-opacity"
        :style="{
          borderColor: 'var(--safelight)',
          opacity: selected ? 1 : 0,
          borderRadius: '40% 44% 42% 45% / 46% 40% 44% 42%',
          transform: selected ? 'rotate(-1.2deg)' : 'scale(0.92)',
          transition: 'opacity .14s ease, transform .14s ease',
        }"
      />
      <span class="absolute left-1 top-1 font-mono text-micro text-ink-3">{{ String(index + 1).padStart(2, "0") }}</span>
      <button
        v-if="selectable"
        class="absolute right-2 top-2 h-5 w-5 border bg-paper/85 text-center font-mono text-micro leading-[1.1rem]"
        :class="selected ? 'border-safelight text-safelight' : 'border-rule-strong text-transparent hover:text-ink-3'"
        :aria-label="`select ${file.name}`"
        :aria-pressed="selected"
        @click.stop="emit('select', $event)"
      >
        ✓
      </button>
    </div>

    <div class="mt-2 flex items-baseline justify-between gap-2">
      <p class="truncate text-label" :title="file.name">{{ file.name }}</p>
      <span v-if="owner" class="shrink-0 font-mono text-micro text-ink-3" :title="`@${owner}`">@{{ owner }}</span>
      <span v-if="file.accessLevel === 'private'" class="chip shrink-0 border-safelight text-safelight">私</span>
    </div>
    <p class="num mt-0.5 truncate text-micro text-ink-3">
      {{ file.width || "?" }}×{{ file.height || "?" }} · {{ file.sizeHuman }} · {{ file.ext.toUpperCase() }}
      <span v-if="file.views">· {{ file.views }}<span class="text-ink-3"> views</span></span>
    </p>
  </article>

  <article
    v-else
    class="group flex cursor-pointer items-center gap-3 border-b px-3 py-2 transition-colors"
    :style="focused || selected ? 'background: var(--paper-2)' : ''"
    @click="emit('focus')"
    @dblclick="emit('open')"
  >
    <button
      v-if="selectable"
      class="h-4 w-4 shrink-0 border text-center font-mono text-micro leading-[0.85rem]"
      :class="selected ? 'border-safelight text-safelight' : 'border-rule-strong text-transparent'"
      :aria-label="`select ${file.name}`"
      @click.stop="emit('select', $event)"
    >
      ✓
    </button>
    <div class="h-9 w-9 shrink-0 border bg-paper-2">
      <img v-if="!trashed" :src="thumb" :alt="file.name" loading="lazy" class="h-full w-full object-cover" />
      <div v-else class="flex h-full w-full items-center justify-center" style="background: var(--paper-3)">
        <span class="font-mono text-[9px] uppercase text-ink-3">trash</span>
      </div>
    </div>
    <p class="w-1/3 min-w-0 truncate text-label">{{ file.name }}</p>
    <p class="num flex-1 truncate text-micro text-ink-3">
      {{ file.width }}×{{ file.height }} · {{ file.sizeHuman }} · {{ file.ext.toUpperCase() }}
    </p>
    <p v-if="owner" class="label hidden w-28 shrink-0 truncate md:block">@{{ owner }}</p>
    <p class="label hidden shrink-0 md:block">{{ file.accessLevel }}</p>
    <p class="num w-16 shrink-0 text-right text-micro text-ink-3">{{ file.views }}</p>
  </article>
</template>
