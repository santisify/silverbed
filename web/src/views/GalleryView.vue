<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { galleryApi, type GalleryFolderPick, type GalleryItem, type GalleryOwnerCount } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import FrameTile from "@/components/FrameTile.vue";
import Lightbox from "@/components/Lightbox.vue";
import EmptyState from "@/components/EmptyState.vue";
import ModalDialog from "@/components/ModalDialog.vue";
import { useJustifiedRows } from "@/composables/justifiedRows";

const auth = useAuthStore();
const meta = useMetaStore();
const ui = useUiStore();
const { t } = useI18n();


const PAGE_SIZE = 24;

const items = ref<GalleryItem[]>([]);
const total = ref(0);
const page = ref(1);
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const loading = ref(false);

const query = ref("");
const sort = ref<"newest" | "oldest" | "name" | "size" | "views">("newest");
const layout = ref<"sheet" | "grid" | "list">("sheet");
const mineOnly = ref(false);
const ownerFilter = ref("");
const scope = ref<"active" | "trash">("active");

/** Cards follow each frame's own proportions; rows are packed edge to edge. */
const {
  container: sheetEl,
  rows: sheetRows,
} = useJustifiedRows<GalleryItem>({
  items,
  ratio: (item) => (item.width && item.height ? item.width / item.height : 1),
  targetHeight: (width) =>
    layout.value === "grid"
      ? Math.min(150, Math.max(64, width / 8.5))
      : Math.min(320, Math.max(150, width / 4.2)),
});

const owners = ref<GalleryOwnerCount[]>([]);
const selection = ref<string[]>([]);
const lightboxIndex = ref<number | null>(null);
const busy = ref(false);

const showMove = ref(false);
const moveTarget = ref("");
const moveFolders = ref<GalleryFolderPick[]>([]);
const showTag = ref(false);
const tagInput = ref("");

const manageable = computed(() => items.value.filter((item) => item.canManage));
const selectedFiles = computed(() => items.value.filter((item) => selection.value.includes(item.id)));
const selectedOwnerIds = computed(() => [...new Set(selectedFiles.value.map((item) => item.owner.id))]);
const canMove = computed(() => selectedOwnerIds.value.length === 1);

const toastKey: Record<string, string> = {
  delete: "toast.deleted",
  restore: "toast.restored",
  purge: "toast.purged",
  tag: "toast.tagged",
  access: "gallery.madePrivate",
  move: "toast.moved",
};

onMounted(async () => {
  await load();
  if (auth.isAdmin) await loadOwners();
});

async function loadOwners() {
  try {
    owners.value = await galleryApi.owners();
  } catch {
    owners.value = [];
  }
}

async function load() {
  loading.value = true;
  try {
    const res = await galleryApi.list({
      page: page.value,
      pageSize: PAGE_SIZE,
      q: query.value || undefined,
      sort: sort.value,
      scope: scope.value,
      owner: ownerFilter.value || undefined,
      mine: mineOnly.value ? 1 : undefined,
    });
    items.value = res.items;
    total.value = res.total;
    const visible = new Set(res.items.filter((item) => item.canManage).map((item) => item.id));
    selection.value = selection.value.filter((id) => visible.has(id));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function changeFilter() {
  page.value = 1;
  selection.value = [];
  void load();
}

function setPage(next: number) {
  page.value = Math.min(pages.value, Math.max(1, next));
  selection.value = [];
  void load();
}

function changeSort(value: string) {
  sort.value = value as typeof sort.value;
  changeFilter();
}

function changeLayout(next: "sheet" | "grid" | "list") {
  layout.value = next;
}

function changeScope(next: "active" | "trash") {
  scope.value = next;
  if (next === "trash") {
    mineOnly.value = false;
    ownerFilter.value = "";
  }
  page.value = 1;
  selection.value = [];
  void load();
}

function toggleMine() {
  mineOnly.value = !mineOnly.value;
  changeFilter();
}

function toggleSelect(item: GalleryItem) {
  if (!item.canManage) return;
  selection.value = selection.value.includes(item.id)
    ? selection.value.filter((id) => id !== item.id)
    : [...selection.value, item.id];
}

function selectAll() {
  selection.value = manageable.value.map((item) => item.id);
}

function clearSelection() {
  selection.value = [];
}

function openLightbox(item: GalleryItem) {
  const index = items.value.findIndex((row) => row.id === item.id);
  lightboxIndex.value = index >= 0 ? index : 0;
}

async function batch(action: string, value?: string) {
  if (!selection.value.length) return;
  busy.value = true;
  try {
    const res = await galleryApi.batch(action, [...selection.value], value);
    selection.value = [];
    await load();
    if (auth.isAdmin) await loadOwners();
    ui.success(t(toastKey[action] ?? "gallery.batchDone"));
    if (res.skipped.length) ui.info(t("gallery.skipped", { n: res.skipped.length }));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    busy.value = false;
    showMove.value = false;
    showTag.value = false;
    tagInput.value = "";
  }
}

async function openMove() {
  if (!canMove.value) {
    ui.error(t("gallery.sameOwnerRequired"));
    return;
  }
  try {
    moveFolders.value = await galleryApi.ownerFolders(selectedOwnerIds.value[0]!);
    moveTarget.value = "";
    showMove.value = true;
  } catch (err) {
    ui.error((err as Error).message);
  }
}

function applyMove() {
  if (!moveTarget.value) return;
  void batch("move", moveTarget.value === "root" ? "" : moveTarget.value);
}

function applyTag() {
  const value = tagInput.value.trim();
  if (!value) return;
  void batch("tag", value);
}
</script>

<template>
  <div class="min-h-screen bg-paper">
    <header class="sticky top-0 z-40 border-b bg-paper">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        <RouterLink to="/" class="flex items-center gap-2">
          <span class="flex h-6 w-8 items-center justify-center border border-ink">
            <span class="h-2.5 w-2.5 rounded-full border border-safelight" />
          </span>
          <span class="text-label font-semibold tracking-tight">{{ meta.meta?.siteName ?? "Silverbed" }}</span>
        </RouterLink>

        <nav class="ml-3 hidden items-center gap-1 md:flex">
          <RouterLink
            :to="{ name: 'gallery' }"
            class="px-2 py-1 text-label text-ink"
            style="box-shadow: inset 0 -2px 0 var(--safelight)"
          >
            {{ t("nav.gallery") }}
          </RouterLink>
          <RouterLink
            v-if="auth.isAuthenticated"
            :to="{ name: 'library' }"
            class="px-2 py-1 text-label text-ink-2 transition-colors hover:text-ink"
          >
            {{ t("nav.library") }}
          </RouterLink>
          <RouterLink
            v-if="auth.isAdmin"
            :to="{ name: 'admin' }"
            class="px-2 py-1 text-label text-ink-2 transition-colors hover:text-ink"
          >
            {{ t("nav.admin") }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <button
            class="btn btn-ghost h-8 px-2 font-mono text-micro"
            :title="t('settings.language')"
            @click="meta.setLocale(meta.locale === 'zh' ? 'en' : 'zh')"
          >
            {{ meta.locale === "zh" ? "中文" : "EN" }}
          </button>
          <button class="btn btn-ghost h-8 px-2 font-mono text-micro" :title="t('settings.theme')" @click="meta.toggleTheme()">
            {{ meta.theme === "dark" ? "◐" : "◑" }}
          </button>
          <template v-if="auth.isAuthenticated">
            <span class="hidden font-mono text-micro text-ink-2 sm:block">{{ auth.user?.username }}</span>
            <RouterLink :to="{ name: 'library' }" class="btn h-8">{{ t("nav.library") }}</RouterLink>
          </template>
          <template v-else>
            <RouterLink :to="{ name: 'login', query: { redirect: '/gallery' } }" class="btn btn-ghost h-8">
              {{ t("common.signIn") }}
            </RouterLink>
            <RouterLink :to="{ name: 'register', query: { redirect: '/gallery' } }" class="btn btn-primary h-8">
              {{ t("common.register") }}
            </RouterLink>
          </template>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-5 pb-16 pt-8">
      <section class="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="label">{{ t("gallery.label") }}</p>
          <h1 class="mt-2 text-display">{{ t("gallery.title") }}</h1>
          <p class="mt-2 max-w-xl text-lead text-ink-2">{{ t("gallery.lead") }}</p>
        </div>
        <p class="num text-micro text-ink-3">{{ total }} {{ t("gallery.frames") }}</p>
      </section>

      <div class="sprocket mt-6" />

      <!-- toolbar -->
      <section class="flex flex-wrap items-center gap-2 py-3">
        <form class="relative" @submit.prevent="changeFilter">
          <input
            v-model="query"
            class="field h-8 w-52 pr-8 text-label"
            :placeholder="t('gallery.searchPlaceholder')"
            type="search"
          />
          <span class="pointer-events-none absolute right-2 top-1.5 font-mono text-micro text-ink-3">⌕</span>
        </form>

        <select class="field h-8 w-auto text-label" :value="sort" @change="changeSort(($event.target as HTMLSelectElement).value)">
          <option value="newest">{{ t("library.sortNewest") }}</option>
          <option value="oldest">{{ t("library.sortOldest") }}</option>
          <option value="name">{{ t("library.sortName") }}</option>
          <option value="size">{{ t("library.sortSize") }}</option>
          <option value="views">{{ t("library.sortViews") }}</option>
        </select>

        <button
          v-if="auth.isAuthenticated && scope === 'active'"
          class="chip h-8"
          :class="mineOnly ? 'chip-on' : ''"
          @click="toggleMine"
        >
          {{ t("gallery.onlyMine") }}
        </button>

        <select
          v-if="auth.isAdmin && scope === 'active'"
          v-model="ownerFilter"
          class="field h-8 w-auto text-label"
          @change="changeFilter"
        >
          <option value="">{{ t("gallery.allOwners") }}</option>
          <option v-for="owner in owners" :key="owner.id" :value="owner.username">@{{ owner.username }} · {{ owner.count }}</option>
        </select>

        <div v-if="auth.isAdmin" class="flex border">
          <button
            class="px-2 py-1 font-mono text-micro"
            :style="scope === 'active' ? 'background: var(--ink); color: var(--paper)' : ''"
            @click="changeScope('active')"
          >
            {{ t("gallery.scopeActive") }}
          </button>
          <button
            class="px-2 py-1 font-mono text-micro"
            :style="scope === 'trash' ? 'background: var(--ink); color: var(--paper)' : ''"
            @click="changeScope('trash')"
          >
            {{ t("gallery.scopeTrash") }}
          </button>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <div class="flex border">
            <button
              class="px-2 py-1 font-mono text-micro"
              :style="layout === 'sheet' ? 'background: var(--ink); color: var(--paper)' : ''"
              @click="changeLayout('sheet')"
            >
              ▦
            </button>
            <button
              class="px-2 py-1 font-mono text-micro"
              :style="layout === 'grid' ? 'background: var(--ink); color: var(--paper)' : ''"
              @click="changeLayout('grid')"
            >
              ▩
            </button>
            <button
              class="px-2 py-1 font-mono text-micro"
              :style="layout === 'list' ? 'background: var(--ink); color: var(--paper)' : ''"
              @click="changeLayout('list')"
            >
              ☰
            </button>
          </div>
          <button class="btn h-8 px-2 text-micro" :disabled="loading" @click="load">{{ t("common.refresh") }}</button>
        </div>
      </section>

      <p v-if="!auth.isAuthenticated" class="border-y bg-paper-2 px-3 py-2 text-label text-ink-2">
        {{ t("gallery.anonymousHint") }}
        <RouterLink :to="{ name: 'login', query: { redirect: '/gallery' } }" class="link ml-1">{{ t("common.signIn") }}</RouterLink>
      </p>

      <!-- selection bar -->
      <Transition name="view-transition">
        <div v-if="selection.length" class="flex flex-wrap items-center gap-2 border-b bg-paper-2 px-3 py-2">
          <span class="font-mono text-micro">{{ selection.length }} {{ t("library.selected") }}</span>
          <button class="btn h-7 px-2 text-micro" @click="selectAll">{{ t("gallery.selectAll") }}</button>
          <button class="btn h-7 px-2 text-micro" @click="clearSelection">{{ t("library.clear") }}</button>
          <div class="mx-1 h-4 w-px bg-rule-strong" />
          <template v-if="scope === 'trash'">
            <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="batch('restore')">
              {{ t("library.batchRestore") }}
            </button>
            <button class="btn btn-danger h-7 px-2 text-micro" :disabled="busy" @click="batch('purge')">
              {{ t("library.batchPurge") }}
            </button>
          </template>
          <template v-else>
            <button
              class="btn h-7 px-2 text-micro"
              :disabled="busy"
              :title="canMove ? '' : t('gallery.sameOwnerRequired')"
              @click="openMove"
            >
              {{ t("library.batchMove") }}
            </button>
            <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="showTag = true">
              {{ t("library.batchTag") }}
            </button>
            <button class="btn h-7 px-2 text-micro" :disabled="busy" @click="batch('access', 'private')">
              {{ t("gallery.makePrivate") }}
            </button>
            <button class="btn btn-danger h-7 px-2 text-micro" :disabled="busy" @click="batch('delete')">
              {{ t("library.batchDelete") }}
            </button>
          </template>
        </div>
      </Transition>

      <p v-if="auth.isAuthenticated && !loading && items.length && !manageable.length" class="py-2 text-label text-ink-3">
        {{ auth.isAdmin ? t("gallery.adminHint") : t("gallery.selectableHint") }}
      </p>

      <!-- sheet -->
      <div v-if="loading" class="grid grid-cols-2 gap-0 border-t border-l md:grid-cols-3 xl:grid-cols-4">
        <div v-for="n in 8" :key="n" class="border-b border-r p-2">
          <div class="aspect-[4/3] animate-pulse" style="background: var(--paper-2)" />
          <div class="mt-2 h-2 w-2/3 animate-pulse" style="background: var(--paper-2)" />
        </div>
      </div>

      <EmptyState
        v-else-if="!items.length"
        class="mt-3"
        :title="scope === 'trash' ? t('gallery.trashEmpty') : t('gallery.emptyTitle')"
        :body="scope === 'trash' ? undefined : t('gallery.emptyBody')"
      >
        <RouterLink
          v-if="scope !== 'trash'"
          :to="auth.isAuthenticated ? { name: 'upload' } : { name: 'login', query: { redirect: '/gallery' } }"
          class="btn btn-primary"
        >
          {{ auth.isAuthenticated ? t("common.upload") : t("common.signIn") }}
        </RouterLink>
      </EmptyState>

      <div v-else ref="sheetEl" :class="layout === 'list' ? 'border-t' : 'border-t border-l'">
        <template v-if="layout === 'list'">
          <FrameTile
            v-for="(item, index) in items"
            :key="item.id"
            :file="item"
            :index="index + (page - 1) * PAGE_SIZE"
            :selected="selection.includes(item.id)"
            :focused="false"
            :layout="layout"
            :selectable="item.canManage"
            :owner="item.owner.username"
            @select="toggleSelect(item)"
            @focus="openLightbox(item)"
            @open="openLightbox(item)"
          />
        </template>

        <template v-else>
          <div v-for="row in sheetRows" :key="row.key" class="flex">
            <FrameTile
              v-for="entry in row.items"
              :key="entry.item.id"
              :file="entry.item"
              :width="entry.width"
              :index="entry.index + (page - 1) * PAGE_SIZE"
              :selected="selection.includes(entry.item.id)"
              :focused="false"
              :layout="layout"
              :selectable="entry.item.canManage"
              :owner="entry.item.owner.username"
              @select="toggleSelect(entry.item)"
              @focus="openLightbox(entry.item)"
              @open="openLightbox(entry.item)"
            />
          </div>
        </template>
      </div>

      <div v-if="pages > 1" class="flex items-center justify-between border-t px-3 py-2">
        <span class="num text-micro text-ink-3">{{ t("common.page") }} {{ page }} {{ t("common.of") }} {{ pages }}</span>
        <div class="flex gap-1">
          <button class="btn h-7 px-2 text-micro" :disabled="page === 1" @click="setPage(page - 1)">←</button>
          <button class="btn h-7 px-2 text-micro" :disabled="page === pages" @click="setPage(page + 1)">→</button>
        </div>
      </div>
    </main>

    <Lightbox
      v-if="lightboxIndex !== null"
      :files="items"
      :index="lightboxIndex"
      @close="lightboxIndex = null"
      @navigate="lightboxIndex = $event"
    />

    <ModalDialog v-if="showMove" :title="t('library.batchMove')" @close="showMove = false">
      <label class="label" for="gallery-move-target">{{ t("gallery.moveTo") }}</label>
      <select id="gallery-move-target" v-model="moveTarget" class="field mt-1">
        <option value="root">{{ t("library.root") }}</option>
        <option v-for="folder in moveFolders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
      </select>
      <p class="mt-2 font-mono text-micro text-ink-3">{{ t("gallery.moveHint") }}</p>
      <template #footer>
        <button class="btn" @click="showMove = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!moveTarget" @click="applyMove">{{ t("common.move") }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="showTag" :title="t('library.batchTag')" @close="showTag = false">
      <label class="label" for="gallery-tag-input">{{ t("library.tags") }}</label>
      <input id="gallery-tag-input" v-model="tagInput" class="field mt-1" :placeholder="t('upload.tagsPlaceholder')" />
      <template #footer>
        <button class="btn" @click="showTag = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!tagInput.trim()" @click="applyTag">{{ t("common.save") }}</button>
      </template>
    </ModalDialog>
  </div>
</template>
