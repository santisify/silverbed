<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { filesApi, type Folder, type UploadedFile } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useMetaStore } from "@/stores/meta";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { humanBytes } from "@/composables/format";
import ProgressBar from "@/components/ProgressBar.vue";

type State = "pending" | "uploading" | "done" | "duplicate" | "failed";

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  state: State;
  progress: number;
  error?: string;
  result?: UploadedFile;
}

const library = useLibraryStore();
const meta = useMetaStore();
const ui = useUiStore();
const router = useRouter();
const { t } = useI18n();

const queue = ref<QueueItem[]>([]);
const dragging = ref(false);
const options = reactive({ folderId: "", tags: "", expiresInDays: 0, accessLevel: "public" });
const folders = ref<Folder[]>([]);
const instant = ref(true);

const maxMb = computed(() => meta.meta?.maxUploadMb ?? 32);
const pendingCount = computed(() => queue.value.filter((q) => q.state === "pending").length);
const doneCount = computed(() => queue.value.filter((q) => q.state === "done" || q.state === "duplicate").length);
const overall = computed(() => {
  const active = queue.value.filter((q) => q.state !== "pending");
  if (!active.length) return 0;
  return Math.round(active.reduce((sum, q) => sum + q.progress, 0) / active.length);
});

onMounted(async () => {
  await library.loadFolders();
  folders.value = library.folders;
});

function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/") && !/\.(heic|heif|tiff?|svg|ico|avif)$/i.test(file.name)) {
      ui.error(`${file.name} is not an image`);
      continue;
    }
    queue.value.push({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      state: "pending",
      progress: 0,
    });
  }
  if (instant.value) void uploadAll();
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) addFiles(input.files);
  input.value = "";
}

/** PUTs straight to the bucket so the file never passes through the function. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 88));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed (${xhr.status})`));
    xhr.onerror = () =>
      reject(new Error(`upload failed — allow ${window.location.origin} in the bucket CORS rules`));
    xhr.send(file);
  });
}

async function uploadOne(item: QueueItem) {
  if (item.state === "uploading") return;
  item.state = "uploading";
  item.progress = 5;

  // Large images go browser → bucket → import; small instances without bucket
  // storage fall back to the multipart endpoint.
  const ticket = await filesApi
    .signUpload({
      name: item.file.name,
      size: item.file.size,
      folderId: options.folderId || null,
      accessLevel: options.accessLevel,
    })
    .catch((err: Error) => {
      if (/direct uploads/i.test(err.message)) return null;
      throw err;
    });

  try {
    if (ticket) {
      await putWithProgress(ticket.uploadUrl, item.file, ticket.headers, (pct) => (item.progress = pct));
      item.progress = 92;
      const created = await filesApi.importUpload({
        id: ticket.id,
        key: ticket.key,
        name: ticket.name,
        folderId: ticket.folderId,
        accessLevel: ticket.accessLevel,
        tags: options.tags.trim() || undefined,
        expiresInDays: options.expiresInDays,
      });
      item.result = created;
      item.progress = 100;
      item.state = created.deduplicated ? "duplicate" : "done";
      return;
    }

    const form = new FormData();
    form.append("files", item.file, item.file.name);
    if (options.folderId) form.append("folderId", options.folderId);
    if (options.tags.trim()) form.append("tags", options.tags.trim());
    if (options.expiresInDays > 0) form.append("expiresInDays", String(options.expiresInDays));
    form.append("accessLevel", options.accessLevel);
    const timer = setInterval(() => {
      if (item.progress < 88) item.progress += Math.max(1, (90 - item.progress) * 0.18);
    }, 220);
    try {
      const res = await filesApi.upload(form);
      const created = res.files[0];
      item.result = created;
      item.progress = 100;
      item.state = created?.deduplicated ? "duplicate" : "done";
    } finally {
      clearInterval(timer);
    }
  } catch (err) {
    item.state = "failed";
    item.error = (err as Error).message;
    item.progress = 0;
  }
}

async function uploadAll() {
  const pending = queue.value.filter((q) => q.state === "pending" || q.state === "failed");
  for (const item of pending) await uploadOne(item);
  const done = queue.value.filter((q) => q.state === "done").length;
  const dup = queue.value.filter((q) => q.state === "duplicate").length;
  if (done) ui.success(t("toast.uploaded", { n: done }));
  if (dup) ui.info(t("toast.deduplicated", { n: dup }));
  await Promise.all([library.loadFolders(), library.loadTags()]);
}

function clearDone() {
  queue.value = queue.value.filter((q) => q.state !== "done" && q.state !== "duplicate");
}

function reset() {
  for (const item of queue.value) URL.revokeObjectURL(item.previewUrl);
  queue.value = [];
}

function stateLabel(state: State) {
  return {
    pending: "queued",
    uploading: t("upload.uploading"),
    done: t("upload.done"),
    duplicate: t("upload.duplicate"),
    failed: t("upload.failed"),
  }[state];
}
</script>

<template>
  <div class="grid gap-0 lg:grid-cols-[1fr_20rem]">
    <div class="min-w-0 border-r">
      <div class="border-b px-4 py-3">
        <h1 class="text-title">{{ t("upload.title") }}</h1>
        <p class="mt-1 text-label text-ink-2">{{ t("upload.instantHint") }}</p>
      </div>

      <label
        class="m-4 flex cursor-pointer flex-col items-center justify-center border border-dashed px-6 py-14 text-center transition-colors"
        :style="dragging ? 'background: var(--safelight-soft); border-color: var(--safelight)' : ''"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input type="file" multiple accept="image/*,.heic,.heif,.avif,.svg" class="sr-only" @change="onPick" />
        <div class="mb-3 h-10 w-14 border border-rule-strong pt-1.5">
          <div class="mx-auto h-4 w-4 rounded-full border border-safelight"></div>
        </div>
        <p class="text-title">{{ t("upload.dropTitle") }}</p>
        <p class="mt-1 max-w-sm text-label text-ink-2">{{ t("upload.dropBody", { mb: maxMb }) }}</p>
        <span class="btn btn-primary mt-4">{{ t("upload.choose") }}</span>
      </label>

      <div class="flex items-center justify-between border-y px-4 py-2">
        <p class="label">{{ t("upload.queue") }} <span class="num">{{ queue.length }}</span></p>
        <div class="flex gap-2">
          <button class="btn h-7 px-2 text-micro" :disabled="!doneCount" @click="clearDone">{{ t("upload.clearDone") }}</button>
          <button class="btn h-7 px-2 text-micro" :disabled="!queue.length" @click="reset">{{ t("common.clear") }}</button>
          <button class="btn btn-primary h-7 px-3 text-micro" :disabled="!pendingCount" @click="uploadAll">{{ t("upload.startAll") }}</button>
        </div>
      </div>

      <div v-if="queue.length" class="px-4 py-3">
        <div class="mb-3 flex items-center gap-3">
          <span class="label">total</span>
          <div class="flex-1"><ProgressBar :value="overall" /></div>
          <span class="num text-micro text-ink-3">{{ overall }}%</span>
        </div>
        <ul class="divide-y border">
          <li v-for="item in queue" :key="item.id" class="flex items-center gap-3 px-3 py-2">
            <img :src="item.previewUrl" :alt="item.file.name" class="h-10 w-10 shrink-0 border object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-label">{{ item.file.name }}</p>
              <div class="mt-1 flex items-center gap-2">
                <div class="flex-1">
                  <ProgressBar
                    :value="item.progress"
                    :tone="item.state === 'failed' ? 'safelight' : item.state === 'done' || item.state === 'duplicate' ? 'kept' : 'ink'"
                  />
                </div>
                <span class="num w-20 shrink-0 text-right text-micro text-ink-3">{{ humanBytes(item.file.size) }}</span>
              </div>
              <p v-if="item.error" class="mt-1 font-mono text-micro" style="color: var(--safelight)">{{ item.error }}</p>
            </div>
            <span
              class="chip shrink-0"
              :class="item.state === 'duplicate' ? 'border-mark text-mark' : item.state === 'failed' ? 'border-safelight text-safelight' : item.state === 'done' ? 'border-kept text-kept' : ''"
            >
              {{ stateLabel(item.state) }}
            </span>
            <button v-if="item.state === 'failed'" class="btn h-7 px-2 text-micro" @click="uploadOne(item)">{{ t("upload.retry") }}</button>
          </li>
        </ul>
      </div>

      <p v-else class="px-4 py-16 text-center font-mono text-micro text-ink-3">{{ t("upload.noQueue") }}</p>
    </div>

    <!-- upload options -->
    <aside class="px-4 py-3">
      <p class="label">{{ t("upload.destination") }}</p>
      <select v-model="options.folderId" class="field mt-1">
        <option value="">{{ t("library.root") }}</option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
      </select>

      <label class="label mt-3 block" for="upload-tags">{{ t("library.tags") }}</label>
      <input id="upload-tags" v-model="options.tags" class="field mt-1" :placeholder="t('upload.tagsPlaceholder')" />

      <label class="label mt-3 block" for="upload-access">{{ t("upload.accessLevel") }}</label>
      <select id="upload-access" v-model="options.accessLevel" class="field mt-1">
        <option value="public">{{ t("common.public") }}</option>
        <option value="private">{{ t("common.private") }}</option>
      </select>

      <label class="label mt-3 block" for="upload-expiry">{{ t("upload.expires") }}</label>
      <input id="upload-expiry" v-model.number="options.expiresInDays" type="number" min="0" class="field mt-1" placeholder="0 = forever" />

      <label class="mt-4 flex items-center gap-2 text-label">
        <input v-model="instant" type="checkbox" class="h-3.5 w-3.5 accent-current" />
        {{ t("upload.instantHint") }}
      </label>

      <button class="btn mt-4 w-full" @click="router.push({ name: 'library' })">{{ t("nav.library") }} →</button>
    </aside>
  </div>
</template>
