<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { statsApi, type Overview } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "@/i18n";
import { humanBytes, relativeTime } from "@/composables/format";
import Sparkline from "@/components/Sparkline.vue";
import StatBlock from "@/components/StatBlock.vue";

const { t } = useI18n();
const auth = useAuthStore();
const data = ref<Overview | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    data.value = await statsApi.overview();
  } finally {
    loading.value = false;
  }
});

const days = computed(() => {
  const rows = data.value?.timeline ?? [];
  if (!rows.length) return [] as { day: string; count: number; bytes: number }[];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; count: number; bytes: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(date) ?? { day: date, count: 0, bytes: 0 });
  }
  return out;
});

const formatTotal = computed(() => (data.value?.byFormat ?? []).reduce((sum, f) => sum + f.count, 0));
</script>

<template>
  <div class="px-4 py-4">
    <div class="mb-4">
      <h1 class="text-display">{{ t("stats.title") }}</h1>
      <p class="mt-1 text-label text-ink-2">
        {{ auth.user?.username }} · {{ t("settings.memberSince") }} {{ new Date(auth.user?.createdAt ?? Date.now()).toLocaleDateString() }}
      </p>
    </div>

    <div v-if="loading" class="border px-4 py-16 text-center font-mono text-micro text-ink-3">{{ t("common.loading") }}…</div>

    <template v-else-if="data">
      <div class="grid grid-cols-2 border border-b-0 md:grid-cols-4">
        <StatBlock :label="t('stats.frames')" :value="data.totals.files" />
        <StatBlock :label="t('stats.storage')" :value="data.totals.bytesHuman" />
        <StatBlock :label="t('stats.views')" :value="data.totals.views" />
        <StatBlock :label="t('stats.downloads')" :value="data.totals.downloads" />
      </div>

      <section class="grid gap-0 border md:grid-cols-[1.4fr_1fr]">
        <div class="border-r p-4">
          <div class="flex items-baseline justify-between">
            <p class="label">{{ t("stats.uploads30") }}</p>
            <p class="num text-micro text-ink-3">
              {{ days.reduce((sum, d) => sum + d.count, 0) }} frames ·
              {{ humanBytes(days.reduce((sum, d) => sum + d.bytes, 0)) }}
            </p>
          </div>
          <div class="mt-4">
            <Sparkline :values="days.map((d) => d.count)" :height="72" :label="t('stats.uploads30')" />
          </div>
          <div class="mt-1 flex justify-between font-mono text-micro text-ink-3">
            <span>{{ days[0]?.day }}</span>
            <span>{{ days[days.length - 1]?.day }}</span>
          </div>
        </div>

        <div class="p-4">
          <p class="label">{{ t("stats.quota") }}</p>
          <template v-if="data.quota.limit > 0">
            <p class="num mt-2 text-title">{{ humanBytes(data.quota.used) }} <span class="text-ink-3">/ {{ humanBytes(data.quota.limit) }}</span></p>
            <div class="mt-2 h-[3px]" style="background: var(--paper-3)">
              <div class="h-full" :style="{ width: `${data.quota.percent ?? 0}%`, background: (data.quota.percent ?? 0) > 90 ? 'var(--safelight)' : 'var(--ink)' }" />
            </div>
          </template>
          <p v-else class="mt-2 text-label text-ink-2">{{ t("stats.noQuota") }}</p>

          <p class="label mt-5">{{ t("stats.formats") }}</p>
          <ul class="mt-2 space-y-1.5">
            <li v-for="format in data.byFormat" :key="format.ext" class="flex items-center gap-2">
              <span class="w-12 font-mono text-micro">{{ format.ext.toUpperCase() }}</span>
              <div class="h-2 flex-1" style="background: var(--paper-2)">
                <div class="h-full" :style="{ width: `${(format.count / Math.max(1, formatTotal)) * 100}%`, background: 'var(--ink)' }" />
              </div>
              <span class="num w-8 text-right text-micro text-ink-3">{{ format.count }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="grid gap-0 border border-t-0 md:grid-cols-2">
        <div class="border-r p-4">
          <p class="label">{{ t("stats.top") }}</p>
          <ul class="mt-2 divide-y">
            <li v-for="item in data.top" :key="item.id" class="flex items-center gap-3 py-2">
              <div class="h-8 w-8 shrink-0 border bg-paper-2">
                <img :src="`/i/${item.id}.thumb.webp`" :alt="item.name" class="h-full w-full object-cover" />
              </div>
              <span class="min-w-0 flex-1 truncate text-label">{{ item.name }}</span>
              <span class="num text-micro text-ink-3">{{ item.views }} views</span>
            </li>
            <li v-if="!data.top.length" class="py-4 font-mono text-micro text-ink-3">{{ t("common.empty") }}</li>
          </ul>
        </div>

        <div class="p-4">
          <p class="label">{{ t("stats.recentAccess") }}</p>
          <ul class="mt-2 divide-y">
            <li v-for="row in data.recentAccess" :key="row.id" class="flex items-center gap-3 py-2">
              <span class="chip">{{ row.kind }}</span>
              <span class="num min-w-0 flex-1 truncate text-micro text-ink-2">{{ row.ip ?? "—" }}</span>
              <span class="truncate text-micro text-ink-3" style="max-width: 9rem">{{ row.referer || "direct" }}</span>
              <span class="num shrink-0 text-micro text-ink-3">{{ relativeTime(row.createdAt) }}</span>
            </li>
            <li v-if="!data.recentAccess.length" class="py-4 font-mono text-micro text-ink-3">No traffic recorded yet.</li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
