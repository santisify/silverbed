import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { filesApi, foldersApi, tagsApi, type Folder, type FolderNode, type ImageFile, type Tag } from "@/api";

export type Scope = "active" | "trash";

export const useLibraryStore = defineStore("library", () => {
  const files = ref<ImageFile[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(40);
  const loading = ref(false);

  const folders = ref<Folder[]>([]);
  const tree = ref<FolderNode[]>([]);
  const rootFileCount = ref(0);
  const tags = ref<Tag[]>([]);

  const folderId = ref<string>("root");
  const scope = ref<Scope>("active");
  const access = ref<"" | "public" | "private">("");
  const query = ref("");
  const activeTag = ref("");
  const sort = ref<"newest" | "oldest" | "name" | "size" | "views">("newest");
  const layout = ref<"sheet" | "grid" | "list">("sheet");

  const selection = ref<string[]>([]);
  const focusedId = ref<string | null>(null);

  const selectedFiles = computed(() => files.value.filter((f) => selection.value.includes(f.id)));
  const focused = computed(() => files.value.find((f) => f.id === focusedId.value) ?? null);
  const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

  async function load() {
    loading.value = true;
    try {
      const res = await filesApi.list({
        page: page.value,
        pageSize: pageSize.value,
        scope: scope.value,
        folderId: folderId.value === "root" ? undefined : folderId.value,
        access: access.value || undefined,
        q: query.value || undefined,
        tag: activeTag.value || undefined,
        sort: sort.value,
      });
      files.value = res.items;
      total.value = res.total;
      if (focusedId.value && !res.items.some((f) => f.id === focusedId.value)) focusedId.value = res.items[0]?.id ?? null;
      if (!focusedId.value) focusedId.value = res.items[0]?.id ?? null;
    } finally {
      loading.value = false;
    }
  }

  async function loadFolders() {
    const res = await foldersApi.list();
    folders.value = res.folders;
    tree.value = res.tree;
    rootFileCount.value = res.rootFileCount;
  }

  async function loadTags() {
    tags.value = await tagsApi.list();
  }

  async function refreshAll() {
    await Promise.all([load(), loadFolders(), loadTags()]);
  }

  function reconcile() {
    selection.value = selection.value.filter((id) => files.value.some((f) => f.id === id));
  }

  function toggleSelect(id: string) {
    selection.value = selection.value.includes(id) ? selection.value.filter((x) => x !== id) : [...selection.value, id];
  }

  function selectAll() {
    selection.value = files.value.map((f) => f.id);
  }

  function clearSelection() {
    selection.value = [];
  }

  function focus(id: string) {
    focusedId.value = id;
  }

  function resetFilters() {
    query.value = "";
    activeTag.value = "";
    access.value = "";
    scope.value = "active";
  }

  return {
    files,
    total,
    page,
    pageSize,
    pages,
    loading,
    folders,
    tree,
    rootFileCount,
    tags,
    folderId,
    scope,
    access,
    query,
    activeTag,
    sort,
    layout,
    selection,
    focusedId,
    selectedFiles,
    focused,
    load,
    loadFolders,
    loadTags,
    refreshAll,
    reconcile,
    toggleSelect,
    selectAll,
    clearSelection,
    focus,
    resetFilters,
  };
});
