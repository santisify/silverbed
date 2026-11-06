<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { filesApi, sharesApi, type ImageFile, type Share } from "@/api";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { dateTime, copyText } from "@/composables/format";
import ModalDialog from "@/components/ModalDialog.vue";
import EmptyState from "@/components/EmptyState.vue";

const ui = useUiStore();
const route = useRoute();
const { t, locale } = useI18n();

const shares = ref<Share[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const candidates = ref<ImageFile[]>([]);
const picked = ref<string[]>([]);
const form = reactive({ title: "", password: "", expiresInDays: 0, allowDownload: true });
const creating = ref(false);

onMounted(async () => {
  await refresh();
  const preselect = String(route.query.files ?? "");
  if (preselect) {
    const files = await filesApi.list({ pageSize: 200 });
    candidates.value = files.items;
    picked.value = preselect.split(",").filter(Boolean);
    showCreate.value = true;
  }
});

async function refresh() {
  loading.value = true;
  try {
    shares.value = await sharesApi.list();
  } finally {
    loading.value = false;
  }
}

async function openCreate() {
  const res = await filesApi.list({ pageSize: 200 });
  candidates.value = res.items;
  picked.value = [];
  form.title = "";
  form.password = "";
  form.expiresInDays = 0;
  form.allowDownload = true;
  showCreate.value = true;
}

function togglePick(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id];
}

async function createShare() {
  if (!picked.value.length) return;
  creating.value = true;
  try {
    await sharesApi.create({
      title: form.title,
      fileIds: picked.value,
      password: form.password || undefined,
      expiresInDays: form.expiresInDays || undefined,
      allowDownload: form.allowDownload,
    });
    showCreate.value = false;
    await refresh();
    ui.success(t("toast.shareCreated"));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    creating.value = false;
  }
}

async function copy(share: Share) {
  await copyText(share.url);
  ui.success(t("common.copied"));
}

async function revoke(share: Share) {
  await sharesApi.update(share.id, { revoked: !share.revoked });
  await refresh();
}

async function remove(share: Share) {
  if (!confirm(`${t("shares.deleteShare")}?`)) return;
  await sharesApi.remove(share.id);
  await refresh();
}

const activeCount = computed(() => shares.value.filter((s) => !s.revoked && !s.expired).length);
</script>

<template>
  <div class="px-4 py-4">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-display">{{ t("shares.title") }}</h1>
        <p class="mt-1 text-label text-ink-2">{{ activeCount }} active · {{ shares.length }} total</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">{{ t("shares.newShare") }}</button>
    </div>

    <div v-if="loading" class="border px-4 py-16 text-center font-mono text-micro text-ink-3">{{ t("common.loading") }}…</div>

    <EmptyState v-else-if="!shares.length" :title="t('shares.empty')" :body="t('shares.emptyBody')">
      <button class="btn btn-primary" @click="openCreate">{{ t("shares.newShare") }}</button>
    </EmptyState>

    <div v-else class="border">
      <div class="hidden grid-cols-[2fr_1fr_repeat(3,5rem)_10rem] gap-3 border-b px-3 py-2 md:grid">
        <span class="label">{{ t("shares.title_field") }}</span>
        <span class="label">{{ t("shares.createdAt") }}</span>
        <span class="label text-right">{{ t("shares.items") }}</span>
        <span class="label text-right">{{ t("shares.views") }}</span>
        <span class="label text-right">{{ t("shares.downloads") }}</span>
        <span class="label text-right">actions</span>
      </div>
      <div
        v-for="share in shares"
        :key="share.id"
        class="grid gap-3 border-b px-3 py-2.5 last:border-b-0 md:grid-cols-[2fr_1fr_repeat(3,5rem)_10rem]"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="truncate text-label">{{ share.title || share.token }}</p>
            <span v-if="share.hasPassword" class="chip border-safelight text-safelight">🔒</span>
            <span v-if="share.revoked" class="chip">{{ t("shares.revoked") }}</span>
            <span v-else-if="share.expired" class="chip">{{ t("shares.expired") }}</span>
          </div>
          <button class="mt-1 block max-w-full truncate font-mono text-micro text-ink-3 hover:text-ink" @click="copy(share)">
            {{ share.url }}
          </button>
        </div>
        <span class="num text-micro text-ink-2">{{ dateTime(share.createdAt, locale) }}</span>
        <span class="num text-right text-micro">{{ share.itemCount ?? 0 }}</span>
        <span class="num text-right text-micro">{{ share.viewCount }}</span>
        <span class="num text-right text-micro">{{ share.downloadCount }}</span>
        <div class="flex items-center justify-end gap-1">
          <button class="btn h-7 px-2 text-micro" @click="copy(share)">{{ t("common.copy") }}</button>
          <button class="btn h-7 px-2 text-micro" @click="revoke(share)">{{ share.revoked ? t("common.restore") : t("shares.revoke") }}</button>
          <button class="btn btn-danger h-7 px-2 text-micro" @click="remove(share)">✕</button>
        </div>
      </div>
    </div>

    <ModalDialog v-if="showCreate" :title="t('shares.newShare')" width="44rem" @close="showCreate = false">
      <div class="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div>
          <p class="label">{{ t("shares.items") }} · {{ picked.length }} selected</p>
          <div class="mt-1 grid max-h-72 grid-cols-4 gap-1 overflow-y-auto border p-1">
            <button
              v-for="file in candidates"
              :key="file.id"
              class="relative aspect-square border bg-paper-2"
              :style="picked.includes(file.id) ? 'outline: 2px solid var(--safelight); outline-offset: -2px' : ''"
              :title="file.name"
              @click="togglePick(file.id)"
            >
              <img :src="`/i/${file.id}.thumb.webp`" :alt="file.name" class="h-full w-full object-cover" loading="lazy" />
              <span
                v-if="picked.includes(file.id)"
                class="absolute right-0 top-0 flex h-4 w-4 items-center justify-center font-mono text-[9px] text-white"
                style="background: var(--safelight)"
              >
                {{ picked.indexOf(file.id) + 1 }}
              </span>
            </button>
          </div>
        </div>
        <div>
          <label class="label" for="share-title">{{ t("shares.title_field") }}</label>
          <input id="share-title" v-model="form.title" class="field mt-1" />

          <label class="label mt-3 block" for="share-password">{{ t("shares.password") }}</label>
          <input id="share-password" v-model="form.password" class="field mt-1" :placeholder="t('shares.passwordHint')" />

          <label class="label mt-3 block" for="share-expiry">{{ t("shares.expires") }}</label>
          <input id="share-expiry" v-model.number="form.expiresInDays" type="number" min="0" class="field mt-1" placeholder="0 = forever" />

          <label class="mt-3 flex items-center gap-2 text-label">
            <input v-model="form.allowDownload" type="checkbox" class="h-3.5 w-3.5" />
            {{ t("shares.allowDownload") }}
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="showCreate = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!picked.length || creating" @click="createShare">
          {{ creating ? t("common.loading") : t("common.create") }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
