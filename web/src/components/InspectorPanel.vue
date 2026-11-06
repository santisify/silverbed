<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { filesApi, type ImageFile } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { dateTime, relativeTime } from "@/composables/format";
import CopyField from "./CopyField.vue";

const props = defineProps<{ file: ImageFile | null }>();
const emit = defineEmits<{ close: []; open: [file: ImageFile] }>();

const library = useLibraryStore();
const ui = useUiStore();
const router = useRouter();
const { t, locale } = useI18n();

const draftName = ref("");
const draftDescription = ref("");
const draftTags = ref("");
const saving = ref(false);

/** 2.80 → "2.8", 35.00 → "35" */
const trimNumber = (value: number) => String(Math.round(value * 10) / 10);

const exif = computed(() => props.file?.exif ?? null);
const cameraLine = computed(() => {
  const tags = exif.value;
  if (!tags) return "";
  return [tags.make, tags.model].filter(Boolean).join(" ");
});
const exposureLine = computed(() => {
  const tags = exif.value;
  if (!tags) return "";
  const parts: string[] = [];
  if (tags.exposure) {
    parts.push(tags.exposure >= 1 ? `${trimNumber(tags.exposure)} s` : `1/${Math.round(1 / tags.exposure)} s`);
  }
  if (tags.fNumber) parts.push(`f/${trimNumber(tags.fNumber)}`);
  if (tags.iso) parts.push(`ISO ${Math.round(tags.iso)}`);
  if (tags.focalLength) parts.push(`${trimNumber(tags.focalLength)} mm`);
  return parts.join(" · ");
});

watch(
  () => props.file?.id,
  (id) => {
    if (!props.file) return;
    draftName.value = props.file.name;
    draftDescription.value = props.file.description ?? "";
    draftTags.value = props.file.tags.map((tag) => tag.name).join(", ");
    void id;
  },
  { immediate: true },
);

const urls = computed(() => {
  if (!props.file) return { direct: "", thumb: "", preview: "", markdown: "", html: "" };
  const base = window.location.origin;
  const direct = `${base}/i/${props.file.id}.${props.file.ext}`;
  const thumb = props.file.hasThumb ? `${base}/i/${props.file.id}.thumb.webp` : "";
  const preview = props.file.hasPreview ? `${base}/i/${props.file.id}.preview.webp` : "";
  return {
    direct,
    thumb,
    preview,
    markdown: `![${props.file.name}](${direct})`,
    html: `<img src="${direct}" alt="${props.file.name}" />`,
  };
});

const dirty = computed(() => {
  if (!props.file) return false;
  return (
    draftName.value !== props.file.name ||
    draftDescription.value !== (props.file.description ?? "") ||
    draftTags.value !== props.file.tags.map((tag) => tag.name).join(", ")
  );
});

async function save() {
  if (!props.file) return;
  saving.value = true;
  try {
    const updated = await filesApi.update(props.file.id, {
      name: draftName.value.trim() || props.file.name,
      description: draftDescription.value,
      tags: draftTags.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    const index = library.files.findIndex((f) => f.id === updated.id);
    if (index >= 0) library.files.splice(index, 1, updated);
    ui.success(t("toast.tagged"));
    void library.loadTags();
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function toggleAccess() {
  if (!props.file) return;
  const next = props.file.accessLevel === "public" ? "private" : "public";
  const updated = await filesApi.update(props.file.id, { accessLevel: next });
  const index = library.files.findIndex((f) => f.id === updated.id);
  if (index >= 0) library.files.splice(index, 1, updated);
  ui.success(t("toast.accessUpdated"));
}

async function removeFile() {
  if (!props.file) return;
  await filesApi.remove(props.file.id);
  ui.success(t("toast.deleted"));
  library.clearSelection();
  await library.refreshAll();
}

async function restoreFile() {
  if (!props.file) return;
  await filesApi.restore(props.file.id);
  ui.success(t("toast.restored"));
  await library.refreshAll();
}

async function download() {
  if (!props.file) return;
  window.open(`/i/${props.file.id}.${props.file.ext}?dl=1`, "_blank");
}

function shareThis() {
  if (!props.file) return;
  void router.push({ name: "shares", query: { files: props.file.id } });
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-l bg-paper">
    <header class="flex items-center justify-between border-b px-3 py-2">
      <p class="label">{{ t("library.inspector") }}</p>
      <button class="btn btn-ghost h-6 px-1.5 font-mono text-micro" @click="emit('close')">✕</button>
    </header>

    <div v-if="!file" class="flex flex-1 items-center justify-center px-6 text-center">
      <p class="font-mono text-micro text-ink-3">Select a frame to inspect it.</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto">
      <button class="block w-full border-b bg-paper-2 p-3" @click="emit('open', file)">
        <img :src="`/i/${file.id}.preview.webp`" :alt="file.name" class="mx-auto max-h-56 w-auto object-contain" />
        <p class="mt-2 font-mono text-micro text-ink-3">{{ t("common.view") }} ↗</p>
      </button>

      <div class="border-b px-3 py-3">
        <label class="label" for="frame-name">{{ t("common.rename") }}</label>
        <input id="frame-name" v-model="draftName" class="field mt-1" />
        <label class="label mt-3 block" for="frame-note">{{ t("library.description") }}</label>
        <textarea
          id="frame-note"
          v-model="draftDescription"
          rows="2"
          class="field mt-1 h-auto py-2"
          :placeholder="t('library.descriptionPlaceholder')"
        />
        <label class="label mt-3 block" for="frame-tags">{{ t("library.tags") }}</label>
        <input id="frame-tags" v-model="draftTags" class="field mt-1 font-mono text-meta" placeholder="fieldwork, select" />
        <button class="btn btn-primary mt-3 w-full" :disabled="!dirty || saving" @click="save">
          {{ saving ? t("common.loading") : t("common.save") }}
        </button>
      </div>

      <dl class="border-b px-3 py-2">
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.dimensions") }}</dt>
          <dd class="num text-meta">{{ file.width || "?" }}×{{ file.height || "?" }}</dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.size") }}</dt>
          <dd class="num text-meta">{{ file.sizeHuman }}</dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.format") }}</dt>
          <dd class="num text-meta">{{ file.ext.toUpperCase() }} · {{ file.mime }}</dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.uploaded") }}</dt>
          <dd class="num text-meta" :title="dateTime(file.createdAt, locale)">{{ relativeTime(file.createdAt) }}</dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.access") }}</dt>
          <dd class="text-meta">
            <button class="chip" :class="file.accessLevel === 'private' ? 'border-safelight text-safelight' : 'chip-on'" @click="toggleAccess">
              {{ file.accessLevel === "public" ? t("common.public") : t("common.private") }}
            </button>
          </dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">{{ t("library.views") }} / {{ t("library.downloads") }}</dt>
          <dd class="num text-meta">{{ file.views }} / {{ file.downloads }}</dd>
        </div>
        <div v-if="file.expiresAt" class="flex justify-between py-1">
          <dt class="label">{{ t("library.expires") }}</dt>
          <dd class="num text-meta">{{ dateTime(file.expiresAt, locale) }}</dd>
        </div>
        <div class="flex justify-between py-1">
          <dt class="label">SHA-256</dt>
          <dd class="num truncate text-meta text-ink-3" :title="file.hash">{{ file.hash.slice(0, 16) }}…</dd>
        </div>
      </dl>

      <dl v-if="exif && (cameraLine || exposureLine)" class="border-b px-3 py-2">
        <p class="label mb-1">{{ t("library.exif") }}</p>
        <div v-if="cameraLine" class="flex justify-between gap-2 py-1">
          <dt class="label shrink-0">{{ t("library.camera") }}</dt>
          <dd class="num truncate text-meta" :title="cameraLine">{{ cameraLine }}</dd>
        </div>
        <div v-if="exif.lens" class="flex justify-between gap-2 py-1">
          <dt class="label shrink-0">{{ t("library.lens") }}</dt>
          <dd class="num truncate text-meta" :title="exif.lens">{{ exif.lens }}</dd>
        </div>
        <div v-if="exposureLine" class="flex justify-between gap-2 py-1">
          <dt class="label shrink-0">{{ t("library.exposure") }}</dt>
          <dd class="num truncate text-meta" :title="exposureLine">{{ exposureLine }}</dd>
        </div>
        <div v-if="exif.takenAt" class="flex justify-between gap-2 py-1">
          <dt class="label shrink-0">{{ t("library.captured") }}</dt>
          <dd class="num text-meta">{{ exif.takenAt }}</dd>
        </div>
      </dl>

      <div class="px-3 py-2">
        <p class="label mb-1">{{ t("library.urls") }}</p>
        <CopyField :label="t('library.direct')" :value="urls.direct" mono />
        <CopyField :label="t('library.preview')" :value="urls.preview" mono />
        <CopyField :label="t('library.thumb')" :value="urls.thumb" mono />
        <CopyField :label="t('library.markdown')" :value="urls.markdown" mono />
        <CopyField :label="t('library.html')" :value="urls.html" mono />
      </div>
    </div>

    <footer v-if="file" class="flex items-center gap-2 border-t px-3 py-2">
      <button class="btn flex-1" @click="download">{{ t("common.download") }}</button>
      <button class="btn flex-1" @click="shareThis">Share</button>
      <button v-if="!file.deletedAt" class="btn btn-danger" @click="removeFile">{{ t("common.delete") }}</button>
      <button v-else class="btn" @click="restoreFile">{{ t("common.restore") }}</button>
    </footer>
  </aside>
</template>
