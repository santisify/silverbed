<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { filesApi, foldersApi, type ImageFile } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import FrameTile from "@/components/FrameTile.vue";
import InspectorPanel from "@/components/InspectorPanel.vue";
import Lightbox from "@/components/Lightbox.vue";
import EmptyState from "@/components/EmptyState.vue";
import ModalDialog from "@/components/ModalDialog.vue";
import { useJustifiedRows } from "@/composables/justifiedRows";

const library = useLibraryStore();
const ui = useUiStore();
const { t } = useI18n();

/** Cards follow each frame's own proportions; rows are packed edge to edge. */
const {
  container: sheetEl,
  rows: sheetRows,
} = useJustifiedRows<ImageFile>({
  items: computed(() => library.files),
  ratio: (file) => (file.width && file.height ? file.width / file.height : 1),
  targetHeight: (width) =>
    library.layout === "grid"
      ? Math.min(150, Math.max(64, width / 8.5))
      : Math.min(320, Math.max(150, width / 4.2)),
});

const inspectorOpen = ref(true);
const lightboxIndex = ref<number | null>(null);
const showMove = ref(false);
const showTag = ref(false);
const moveTarget = ref("");
const tagInput = ref("");
const busy = ref(false);

const currentFolderName = computed(() => {
  if (library.folderId === "root") return t("library.root");
  return library.folders.find((f) => f.id === library.folderId)?.name ?? t("library.root");
});

onMounted(async () => {
  await Promise.all([library.load(), library.loadFolders(), library.loadTags()]);
});

async function reload() {
  await library.load();
  library.reconcile();
}

async function setPage(next: number) {
  library.page = Math.min(library.pages, Math.max(1, next));
  await reload();
}

async function changeSort(value: string) {
  library.sort = value as typeof library.sort;
  await reload();
}

async function changeLayout(next: "sheet" | "grid" | "list") {
  library.layout = next;
}

function pick(file: ImageFile) {
  library.focus(file.id);
  inspectorOpen.value = true;
}

function onSelect(file: ImageFile, event: MouseEvent) {
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    library.toggleSelect(file.id);
  } else {
    library.toggleSelect(file.id);
  }
  library.focus(file.id);
}

function openLightbox(file: ImageFile) {
  const index = library.files.findIndex((f) => f.id === file.id);
  lightboxIndex.value = index >= 0 ? index : 0;
}

async function batch(action: string, value?: string) {
  if (!library.selection.length) return;
  busy.value = true;
  try {
    await filesApi.batch(action, library.selection, value);
    library.clearSelection();
    await library.refreshAll();
    ui.success(
      action === "delete"
        ? t("toast.deleted")
        : action === "restore"
          ? t("toast.restored")
          : action === "purge"
            ? t("toast.purged")
            : action === "tag"
              ? t("toast.tagged")
              : action === "access"
                ? t("toast.accessUpdated")
                : t("toast.moved"),
    );
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    busy.value = false;
    showMove.value = false;
    showTag.value = false;
  }
}

async function applyMove() {
  if (!moveTarget.value) return;
  await batch("move", moveTarget.value === "root" ? "" : moveTarget.value);
  moveTarget.value = "";
}

async function applyTag() {
  const value = tagInput.value.trim();
  if (!value) return;
  await batch("tag", value);
  tagInput.value = "";
}

async function togglePrivate() {
  const allPrivate = library.selectedFiles.every((f) => f.accessLevel === "private");
  await batch("access", allPrivate ? "public" : "private");
}
</script>

<template>
  <div class="flex h-[calc(100vh-3.5rem)] flex-col">
    <!-- toolbar -->
    <div class="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
      <h1 class="text-title">{{ currentFolderName }}</h1>
      <span class="num text-micro text-ink-3">{{ library.total }} {{ t("library.frames") }}</span>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <form class="relative" @submit.prevent="library.page = 1; reload()">
          <input
            v-model="library.query"
            class="field h-8 w-56 pr-8 text-label"
            :placeholder="t('library.searchPlaceholder')"
            type="search"
          />
          <span class="pointer-events-none absolute right-2 top-1.5 font-mono text-micro text-ink-3">⌕</span>
        </form>

        <select class="field h-8 w-auto text-label" :value="library.sort" @change="changeSort(($event.target as HTMLSelectElement).value)">
          <option value="newest">{{ t("library.sortNewest") }}</option>
          <option value="oldest">{{ t("library.sortOldest") }}</option>
          <option value="name">{{ t("library.sortName") }}</option>
          <option value="size">{{ t("library.sortSize") }}</option>
          <option value="views">{{ t("library.sortViews") }}</option>
        </select>

        <select
          class="field h-8 w-auto text-label"
          :value="library.access"
          @change="library.access = ($event.target as HTMLSelectElement).value as any; library.page = 1; reload()"
        >
          <option value="">{{ t("common.all") }}</option>
          <option value="public">{{ t("common.public") }}</option>
          <option value="private">{{ t("common.private") }}</option>
        </select>

        <div class="flex border">
          <button class="px-2 py-1 font-mono text-micro" :style="library.layout === 'sheet' ? 'background: var(--ink); color: var(--paper)' : ''" @click="changeLayout('sheet')">▦</button>
          <button class="px-2 py-1 font-mono text-micro" :style="library.layout === 'grid' ? 'background: var(--ink); color: var(--paper)' : ''" @click="changeLayout('grid')">▩</button>
          <button class="px-2 py-1 font-mono text-micro" :style="library.layout === 'list' ? 'background: var(--ink); color: var(--paper)' : ''" @click="changeLayout('list')">☰</button>
        </div>

        <button class="btn h-8" @click="inspectorOpen = !inspectorOpen">{{ t("library.inspector") }}</button>
      </div>
    </div>

    <!-- selection bar -->
    <Transition name="view-transition">
      <div v-if="library.selection.length" class="flex flex-wrap items-center gap-2 border-b bg-paper-2 px-4 py-2">
        <span class="font-mono text-micro">{{ library.selection.length }} {{ t("library.selected") }}</span>
        <button class="btn h-7 px-2 text-micro" @click="library.selectAll()">{{ t("library.selectAll") }}</button>
        <button class="btn h-7 px-2 text-micro" @click="library.clearSelection()">{{ t("library.clear") }}</button>
        <div class="mx-1 h-4 w-px bg-rule-strong" />
        <template v-if="library.scope === 'trash'">
          <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="batch('restore')">{{ t("library.batchRestore") }}</button>
          <button class="btn btn-danger h-7 px-2 text-micro" :disabled="busy" @click="batch('purge')">{{ t("library.batchPurge") }}</button>
        </template>
        <template v-else>
          <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="showMove = true">{{ t("library.batchMove") }}</button>
          <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="showTag = true">{{ t("library.batchTag") }}</button>
          <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="togglePrivate">{{ t("library.batchAccess") }}</button>
          <button class="btn btn-danger h-7 px-2 text-micro" :disabled="busy" @click="batch('delete')">{{ t("library.batchDelete") }}</button>
        </template>
      </div>
    </Transition>

    <div class="flex min-h-0 flex-1">
      <!-- contact sheet -->
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div v-if="library.loading" class="sheet-grid grid grid-cols-2 gap-0 border-b border-r md:grid-cols-3 xl:grid-cols-4">
          <div v-for="n in 8" :key="n" class="border-b border-r p-2">
            <div class="aspect-[4/3] animate-pulse" style="background: var(--paper-2)" />
            <div class="mt-2 h-2 w-2/3 animate-pulse" style="background: var(--paper-2)" />
          </div>
        </div>

        <EmptyState
          v-else-if="!library.files.length"
          class="m-4"
          :title="library.scope === 'trash' ? t('library.trashEmpty') : t('library.emptyTitle')"
          :body="library.scope === 'trash' ? undefined : t('library.emptyBody')"
        >
          <RouterLink v-if="library.scope !== 'trash'" :to="{ name: 'upload' }" class="btn btn-primary">{{ t("common.upload") }}</RouterLink>
        </EmptyState>

        <div v-else ref="sheetEl" :class="library.layout === 'list' ? 'border-t' : 'border-t border-l'">
          <template v-if="library.layout === 'list'">
            <FrameTile
              v-for="(file, index) in library.files"
              :key="file.id"
              :file="file"
              :index="index + (library.page - 1) * library.pageSize"
              :selected="library.selection.includes(file.id)"
              :focused="library.focusedId === file.id"
              :layout="library.layout"
              @select="onSelect(file, $event)"
              @focus="pick(file)"
              @open="openLightbox(file)"
            />
          </template>

          <template v-else>
            <div v-for="row in sheetRows" :key="row.key" class="flex">
              <FrameTile
                v-for="entry in row.items"
                :key="entry.item.id"
                :file="entry.item"
                :width="entry.width"
                :index="entry.index + (library.page - 1) * library.pageSize"
                :selected="library.selection.includes(entry.item.id)"
                :focused="library.focusedId === entry.item.id"
                :layout="library.layout"
                @select="onSelect(entry.item, $event)"
                @focus="pick(entry.item)"
                @open="openLightbox(entry.item)"
              />
            </div>
          </template>
        </div>

        <div v-if="library.pages > 1" class="flex items-center justify-between border-t px-4 py-2">
          <span class="num text-micro text-ink-3">{{ t("common.page") }} {{ library.page }} {{ t("common.of") }} {{ library.pages }}</span>
          <div class="flex gap-1">
            <button class="btn h-7 px-2 text-micro" :disabled="library.page === 1" @click="setPage(library.page - 1)">←</button>
            <button class="btn h-7 px-2 text-micro" :disabled="library.page === library.pages" @click="setPage(library.page + 1)">→</button>
          </div>
        </div>
      </div>

      <!-- inspector -->
      <div v-if="inspectorOpen" class="hidden w-[20rem] shrink-0 xl:block">
        <InspectorPanel :file="library.focused" @close="inspectorOpen = false" @open="openLightbox" />
      </div>
    </div>

    <Lightbox
      v-if="lightboxIndex !== null"
      :files="library.files"
      :index="lightboxIndex"
      @close="lightboxIndex = null"
      @navigate="lightboxIndex = $event"
    />

    <ModalDialog v-if="showMove" :title="t('library.batchMove')" @close="showMove = false">
      <label class="label" for="move-target">Folder</label>
      <select id="move-target" v-model="moveTarget" class="field mt-1">
        <option value="root">{{ t("library.root") }}</option>
        <option v-for="folder in library.folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
      </select>
      <template #footer>
        <button class="btn" @click="showMove = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!moveTarget" @click="applyMove">{{ t("common.move") }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="showTag" :title="t('library.batchTag')" @close="showTag = false">
      <label class="label" for="tag-input">{{ t("library.tags") }}</label>
      <input id="tag-input" v-model="tagInput" class="field mt-1" placeholder="fieldwork, select" />
      <template #footer>
        <button class="btn" @click="showTag = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!tagInput.trim()" @click="applyTag">{{ t("common.save") }}</button>
      </template>
    </ModalDialog>
  </div>
</template>
