<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{ label: string; value: string | null | undefined; mono?: boolean }>();
const { t } = useI18n();
const copied = ref(false);

async function copy() {
  if (!props.value) return;
  try {
    await navigator.clipboard.writeText(props.value);
  } catch {
    const area = document.createElement("textarea");
    area.value = props.value;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1400);
}
</script>

<template>
  <div class="border-b py-2 last:border-b-0">
    <div class="flex items-center justify-between gap-3">
      <span class="label">{{ label }}</span>
      <button class="btn btn-ghost h-6 px-2 font-mono text-micro" :disabled="!value" @click="copy">
        {{ copied ? t("common.copied") : t("common.copy") }}
      </button>
    </div>
    <p v-if="value" class="mt-1 truncate text-label text-ink-2" :class="mono ? 'font-mono text-meta' : ''" :title="value">
      {{ value }}
    </p>
    <p v-else class="mt-1 font-mono text-micro text-ink-3">—</p>
  </div>
</template>
