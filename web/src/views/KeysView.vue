<script setup lang="ts">
import { onMounted, ref } from "vue";
import { keysApi, type ApiKey } from "@/api";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { copyText, dateTime, relativeTime } from "@/composables/format";
import ModalDialog from "@/components/ModalDialog.vue";
import CopyField from "@/components/CopyField.vue";

const ui = useUiStore();
const { t, locale } = useI18n();

const keys = ref<ApiKey[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const keyName = ref("CI pipeline");
const creating = ref(false);
const revealed = ref<ApiKey | null>(null);

const curlSnippet = (secret: string) =>
  `curl -X POST ${window.location.origin}/api/v1/files/upload \\
  -H "X-Access-Key: ${secret}" \\
  -F "files=@./frame.jpg" \\
  -F "tags=fieldwork"`;

onMounted(refresh);

async function refresh() {
  loading.value = true;
  try {
    keys.value = await keysApi.list();
  } finally {
    loading.value = false;
  }
}

async function create() {
  creating.value = true;
  try {
    const created = await keysApi.create(keyName.value || "Untitled key");
    revealed.value = created;
    showCreate.value = false;
    await refresh();
    ui.success(t("toast.keyCreated"));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    creating.value = false;
  }
}

async function toggle(key: ApiKey) {
  await keysApi.update(key.id, { enabled: !key.enabled });
  await refresh();
}

async function remove(key: ApiKey) {
  if (!confirm(`${t("keys.revoke")} ${key.name}?`)) return;
  await keysApi.remove(key.id);
  await refresh();
}
</script>

<template>
  <div class="px-4 py-4">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-display">{{ t("keys.title") }}</h1>
        <p class="mt-1 max-w-xl text-label text-ink-2">{{ t("keys.lead") }}</p>
      </div>
      <button class="btn btn-primary" @click="showCreate = true">{{ t("keys.newKey") }}</button>
    </div>

    <div v-if="loading" class="border px-4 py-16 text-center font-mono text-micro text-ink-3">{{ t("common.loading") }}…</div>
    <div v-else-if="!keys.length" class="border px-4 py-16 text-center">
      <p class="text-title">{{ t("keys.empty") }}</p>
      <button class="btn btn-primary mt-3" @click="showCreate = true">{{ t("keys.newKey") }}</button>
    </div>

    <div v-else class="border">
      <div class="hidden grid-cols-[1.6fr_1fr_1fr_1fr_9rem] gap-3 border-b px-3 py-2 md:grid">
        <span class="label">{{ t("keys.name") }}</span>
        <span class="label">{{ t("keys.created") }}</span>
        <span class="label">{{ t("keys.lastUsed") }}</span>
        <span class="label">{{ t("keys.uploads") }}</span>
        <span class="label text-right">actions</span>
      </div>
      <div v-for="key in keys" :key="key.id" class="grid gap-3 border-b px-3 py-2.5 last:border-b-0 md:grid-cols-[1.6fr_1fr_1fr_1fr_9rem]">
        <div class="min-w-0">
          <p class="truncate text-label">{{ key.name }}</p>
          <p class="num truncate font-mono text-micro text-ink-3">sb_{{ key.prefix }}_••••••••</p>
        </div>
        <span class="num text-micro text-ink-2">{{ dateTime(key.createdAt, locale) }}</span>
        <span class="num text-micro text-ink-2">{{ key.lastUsedAt ? relativeTime(key.lastUsedAt) : "—" }}</span>
        <span class="num text-micro">{{ key.uploadCount }}</span>
        <div class="flex items-center justify-end gap-1">
          <button class="btn h-7 px-2 text-micro" @click="toggle(key)">{{ key.enabled ? t("keys.enabled") : t("keys.disabled") }}</button>
          <button class="btn btn-danger h-7 px-2 text-micro" @click="remove(key)">✕</button>
        </div>
      </div>
    </div>

    <ModalDialog v-if="showCreate" :title="t('keys.newKey')" @close="showCreate = false">
      <label class="label" for="key-name">{{ t("keys.name") }}</label>
      <input id="key-name" v-model="keyName" class="field mt-1" />
      <template #footer>
        <button class="btn" @click="showCreate = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="creating" @click="create">{{ t("common.create") }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="revealed" :title="t('keys.secretTitle')" width="38rem" @close="revealed = null">
      <p class="text-label text-ink-2">{{ t('keys.secretBody') }}</p>
      <CopyField :label="t('keys.newKey')" :value="revealed.secret" mono />
      <p class="label mt-4">{{ t("keys.snippet") }}</p>
      <pre class="mt-1 overflow-x-auto border bg-paper-2 p-3 font-mono text-micro">{{ curlSnippet(revealed.secret ?? "") }}</pre>
      <template #footer>
        <button class="btn" @click="copyText(curlSnippet(revealed.secret ?? ''))">{{ t("common.copy") }}</button>
        <button class="btn btn-primary" @click="revealed = null">{{ t("common.close") }}</button>
      </template>
    </ModalDialog>
  </div>
</template>
