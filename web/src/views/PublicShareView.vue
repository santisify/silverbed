<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { sharesApi, type PublicShare } from "@/api";
import { useI18n } from "@/i18n";
import { dateTime } from "@/composables/format";
import Lightbox from "@/components/Lightbox.vue";

const route = useRoute();
const { t, locale } = useI18n();

const token = String(route.params.token ?? "");
const share = ref<PublicShare | null>(null);
const password = ref("");
const error = ref("");
const busy = ref(false);
const state = ref<"loading" | "locked" | "ready" | "error">("loading");
const lightboxIndex = ref<number | null>(null);

onMounted(load);

async function load(withPassword?: string) {
  try {
    const data = await sharesApi.public(token, withPassword);
    share.value = data;
    state.value = data.locked ? "locked" : "ready";
    document.title = `${data.title || t("shares.title")} — Silverbed`;
  } catch (err) {
    const message = (err as Error).message;
    error.value = message;
    state.value = "error";
  }
}

async function unlock() {
  busy.value = true;
  error.value = "";
  try {
    await sharesApi.unlock(token, password.value);
    await load(password.value);
    if (state.value === "locked") error.value = t("share.wrongPassword");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

const items = computed(() => share.value?.items ?? []);
</script>

<template>
  <div class="min-h-screen bg-paper">
    <header class="border-b">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
        <span class="flex h-6 w-8 items-center justify-center border border-ink">
          <span class="h-2.5 w-2.5 rounded-full border border-safelight"></span>
        </span>
        <span class="text-label font-semibold">Silverbed</span>
        <RouterLink to="/" class="ml-auto font-mono text-micro text-ink-3 hover:text-ink">{{ t("common.back") }} ↗</RouterLink>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-5 py-8">
      <div v-if="state === 'loading'" class="py-20 text-center font-mono text-micro text-ink-3">{{ t("common.loading") }}…</div>

      <div v-else-if="state === 'error'" class="border px-6 py-20 text-center">
        <p class="text-title">{{ error || t("share.notFound") }}</p>
        <RouterLink to="/" class="btn mt-4">{{ t("common.back") }}</RouterLink>
      </div>

      <div v-else-if="state === 'locked'" class="mx-auto max-w-sm border px-5 py-6">
        <h1 class="text-title">{{ t("share.lockedTitle") }}</h1>
        <p class="mt-1 text-label text-ink-2">{{ t("share.lockedBody") }}</p>
        <form class="mt-4 space-y-2" @submit.prevent="unlock">
          <input v-model="password" class="field" type="password" placeholder="••••••" autocomplete="off" />
          <p v-if="error" class="font-mono text-micro" style="color: var(--safelight)">{{ error }}</p>
          <button class="btn btn-primary w-full" type="submit" :disabled="busy">{{ t("share.unlock") }}</button>
        </form>
      </div>

      <template v-else-if="share">
        <div class="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p class="label">{{ t("shares.title") }}</p>
            <h1 class="mt-1 text-display">{{ share.title || t("shares.title") }}</h1>
            <p class="num mt-1 text-micro text-ink-3">
              {{ items.length }} {{ t("share.frames") }} · {{ share.totalHuman }}
              <template v-if="share.expiresAt"> · {{ t("library.expires") }} {{ dateTime(share.expiresAt, locale) }}</template>
            </p>
          </div>
          <a
            v-if="share.allowDownload && items.length"
            :href="`/s/${token}/download`"
            class="btn btn-primary h-9 px-4"
          >
            {{ t("share.downloadAll") }}
          </a>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <button
            v-for="(item, index) in items"
            :key="item.id"
            class="group border bg-paper-2 p-1.5 text-left"
            @click="lightboxIndex = index"
          >
            <div class="aspect-square overflow-hidden border">
              <img
                :src="item.thumbUrl ?? ''"
                :alt="item.name"
                class="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                loading="lazy"
              />
            </div>
            <p class="mt-1 truncate text-label">{{ item.name }}</p>
            <p class="num text-micro text-ink-3">{{ item.width }}×{{ item.height }}</p>
          </button>
        </div>
      </template>
    </main>

    <Lightbox
      v-if="lightboxIndex !== null && share"
      :files="items"
      :index="lightboxIndex"
      @close="lightboxIndex = null"
      @navigate="lightboxIndex = $event"
    />
  </div>
</template>
