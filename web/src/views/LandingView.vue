<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { metaApi, type Meta } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useI18n } from "@/i18n";
import { humanBytes } from "@/composables/format";

const auth = useAuthStore();
const metaStore = useMetaStore();
const router = useRouter();
const { t } = useI18n();

const meta = ref<Meta | null>(null);
const sheet = ref<{ id: string; name: string; ext: string; width: number; height: number }[]>([]);

onMounted(async () => {
  try {
    meta.value = await metaApi.get();
    const res = await fetch("/api/v1/open/list?pageSize=9");
    const json = await res.json();
    sheet.value = json?.data?.items ?? [];
  } catch {
    /* landing works offline */
  }
});

const totalHuman = computed(() => humanBytes(meta.value?.totals.bytes ?? 0));

function enter() {
  void router.push(auth.isAuthenticated ? "/app/library" : meta.value?.allowRegister === false ? "/login" : "/login");
}
</script>

<template>
  <div class="min-h-screen bg-paper">
    <header class="border-b">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        <span class="flex h-6 w-8 items-center justify-center border border-ink">
          <span class="h-2.5 w-2.5 rounded-full border border-safelight"></span>
        </span>
        <span class="text-label font-semibold">{{ meta?.siteName ?? "Silverbed" }}</span>
        <nav class="ml-auto flex items-center gap-3">
          <RouterLink to="/gallery" class="font-mono text-micro text-ink-2 hover:text-ink">{{ t("nav.gallery") }}</RouterLink>
          <button class="font-mono text-micro text-ink-3 hover:text-ink" @click="metaStore.setLocale(metaStore.locale === 'zh' ? 'en' : 'zh')">
            {{ metaStore.locale === "zh" ? "中文" : "EN" }}
          </button>
          <button class="font-mono text-micro text-ink-3 hover:text-ink" @click="metaStore.toggleTheme()">
            {{ metaStore.theme === "dark" ? "◐" : "◑" }}
          </button>
          <RouterLink v-if="auth.isAuthenticated" to="/app/library" class="btn h-8">{{ t("nav.library") }}</RouterLink>
          <template v-else>
            <RouterLink to="/login" class="btn btn-ghost h-8">{{ t("common.signIn") }}</RouterLink>
            <RouterLink v-if="meta?.allowRegister !== false" to="/register" class="btn btn-primary h-8">{{ t("common.register") }}</RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <main>
      <!-- hero: the contact sheet is the subject -->
      <section class="mx-auto max-w-6xl px-5 pb-8 pt-10 lg:pt-14">
        <div class="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div class="rise">
            <p class="label">{{ meta?.siteDescription || t("landing.tagline") }}</p>
            <h1 class="mt-3 text-poster">
              {{ t("landing.tagline") }}
            </h1>
            <p class="mt-5 max-w-md text-lead text-ink-2">{{ t("landing.lead") }}</p>
            <div class="mt-6 flex flex-wrap items-center gap-2">
              <button class="btn btn-primary h-9 px-4" @click="enter">
                {{ auth.isAuthenticated ? t("nav.library") : t("landing.ctaPrimary") }}
              </button>
              <RouterLink to="/gallery" class="btn h-9 px-4">{{ t("landing.ctaSecondary") }}</RouterLink>
            </div>
          </div>

          <!-- live contact sheet preview -->
          <div class="rise" style="animation-delay: 80ms">
            <div class="border bg-paper-2 p-2">
              <div class="mb-2 flex items-center justify-between px-1">
                <span class="label">contact sheet · {{ sheet.length }} frames</span>
                <span class="num text-micro text-ink-3">{{ totalHuman }}</span>
              </div>
              <div class="grid grid-cols-3 gap-1">
                <div
                  v-for="(item, index) in sheet.length ? sheet : Array.from({ length: 9 }).map((_, i) => ({ id: `ph${i}`, name: `frame-${i}`, ext: 'jpg', width: 4, height: 3 }))"
                  :key="item.id"
                  class="relative aspect-[4/3] overflow-hidden border bg-paper"
                >
                  <img
                    v-if="!item.id.startsWith('ph')"
                    :src="`/i/${item.id}.thumb.webp`"
                    :alt="item.name"
                    class="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span class="absolute bottom-0.5 left-1 font-mono text-[9px] text-ink-3">{{ String(index + 1).padStart(2, "0") }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="sprocket mx-auto max-w-6xl" />

      <!-- three points, on the same sheet rather than three cards -->
      <section id="sheet" class="mx-auto grid max-w-6xl gap-0 border-b px-5 py-10 md:grid-cols-3">
        <div class="border-r px-0 pr-6 md:px-6 md:pl-0">
          <p class="num text-micro text-ink-3">01</p>
          <h2 class="mt-2 text-title">Where files live</h2>
          <p class="mt-2 text-label text-ink-2">{{ t("landing.points.keep") }}</p>
        </div>
        <div class="border-r px-0 pr-6 py-6 md:px-6 md:py-0">
          <p class="num text-micro text-ink-3">02</p>
          <h2 class="mt-2 text-title">Links, ready to paste</h2>
          <p class="mt-2 text-label text-ink-2">{{ t("landing.points.urls") }}</p>
        </div>
        <div class="py-6 md:py-0 md:pl-6">
          <p class="num text-micro text-ink-3">03</p>
          <h2 class="mt-2 text-title">Shares with a lock</h2>
          <p class="mt-2 text-label text-ink-2">{{ t("landing.points.share") }}</p>
        </div>
      </section>

      <footer class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 font-mono text-micro text-ink-3">
        <span>{{ meta?.siteName ?? "Silverbed" }} · v{{ meta?.version ?? "1.0.0" }}</span>
        <span>{{ meta?.totals.files ?? 0 }} {{ t("landing.statsFiles") }} · {{ totalHuman }} {{ t("landing.statsBytes") }}</span>
        <RouterLink to="/gallery" class="hover:text-ink">{{ t("nav.gallery") }}</RouterLink>
        <a href="/api/v1/open/random" class="hover:text-ink">/api/v1/open/random</a>
      </footer>
    </main>
  </div>
</template>
