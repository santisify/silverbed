<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { foldersApi, type FolderNode } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { humanBytes } from "@/composables/format";

const library = useLibraryStore();
const auth = useAuthStore();
const ui = useUiStore();
const { t } = useI18n();

const creating = ref(false);
const newName = ref("");
const editingId = ref<string | null>(null);
const editingName = ref("");
const collapsed = ref<Record<string, boolean>>({});

const quota = computed(() => auth.user?.storageQuota ?? 0);
const used = computed(() => auth.user?.storageUsed ?? 0);
const percent = computed(() => (quota.value > 0 ? Math.min(100, (used.value / quota.value) * 100) : 0));

onMounted(async () => {
  await Promise.all([library.loadFolders(), library.loadTags()]);
});

async function selectFolder(id: string) {
  library.folderId = id;
  library.scope = "active";
  library.page = 1;
  library.clearSelection();
  await library.load();
}

async function selectScope(scope: "active" | "trash") {
  library.scope = scope;
  library.folderId = "root";
  library.page = 1;
  library.clearSelection();
  await library.load();
}

async function createFolder() {
  const name = newName.value.trim();
  if (!name) return;
  const parentId = library.folderId !== "root" ? library.folderId : null;
  await foldersApi.create({ name, parentId });
  newName.value = "";
  creating.value = false;
  await library.loadFolders();
  ui.success(t("toast.folderCreated"));
}

async function renameFolder(node: FolderNode) {
  const name = editingName.value.trim();
  editingId.value = null;
  if (!name) return;
  await foldersApi.update(node.id, { name });
  await library.loadFolders();
}

async function removeFolder(node: FolderNode) {
  if (!confirm(`${t("library.deleteFolder")}: ${node.name}?`)) return;
  await foldersApi.remove(node.id);
  if (library.folderId === node.id) await selectFolder("root");
  await library.refreshAll();
}

function toggleTag(name: string) {
  library.activeTag = library.activeTag === name ? "" : name;
  library.page = 1;
  void library.load();
}

function toggleNode(id: string) {
  collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] };
}

function countFor(node: FolderNode): number {
  return node.fileCount + node.children.reduce((sum, child) => sum + countFor(child), 0);
}
</script>

<template>
  <div class="flex min-h-full flex-col">
    <section class="border-b px-3 py-3">
      <p class="label">{{ t("library.filters") }}</p>
      <div class="mt-2 flex flex-col">
        <button
          class="flex items-center justify-between px-2 py-1.5 text-left text-label transition-colors hover:bg-paper-2"
          :style="library.scope === 'active' && library.folderId === 'root' && !library.activeTag ? 'background: var(--paper-2)' : ''"
          @click="selectFolder('root')"
        >
          <span>{{ t("library.root") }}</span>
          <span class="num text-micro text-ink-3">{{ library.rootFileCount }}</span>
        </button>
        <button
          class="flex items-center justify-between px-2 py-1.5 text-left text-label transition-colors hover:bg-paper-2"
          :class="library.scope === 'trash' ? 'text-safelight' : 'text-ink-2'"
          :style="library.scope === 'trash' ? 'background: var(--paper-2)' : ''"
          @click="selectScope('trash')"
        >
          <span>{{ t("common.trash") }}</span>
        </button>
      </div>
    </section>

    <section class="border-b px-3 py-3">
      <div class="flex items-center justify-between">
        <p class="label">Folders</p>
        <button class="btn btn-ghost h-6 px-1.5 font-mono text-micro" @click="creating = !creating">+</button>
      </div>

      <form v-if="creating" class="mt-2 flex gap-1" @submit.prevent="createFolder">
        <input v-model="newName" class="field h-7 text-label" :placeholder="t('library.folderName')" />
        <button class="btn h-7 px-2 text-micro" type="submit">{{ t("common.create") }}</button>
      </form>

      <ul class="mt-2 space-y-0.5">
        <li v-for="node in library.tree" :key="node.id">
          <div
            class="group flex items-center gap-1 px-2 py-1.5 transition-colors hover:bg-paper-2"
            :style="library.folderId === node.id ? 'background: var(--paper-2)' : ''"
          >
            <button v-if="node.children.length" class="w-3 font-mono text-micro text-ink-3" @click="toggleNode(node.id)">
              {{ collapsed[node.id] ? "+" : "−" }}
            </button>
            <span v-else class="w-3" />
            <button class="min-w-0 flex-1 truncate text-left text-label" @click="selectFolder(node.id)">{{ node.name }}</button>
            <span class="num text-micro text-ink-3 group-hover:hidden">{{ countFor(node) }}</span>
            <span class="hidden gap-1 group-hover:flex">
              <button class="font-mono text-micro text-ink-3 hover:text-ink" @click="editingId = node.id; editingName = node.name">✎</button>
              <button class="font-mono text-micro text-ink-3 hover:text-safelight" @click="removeFolder(node)">✕</button>
            </span>
          </div>
          <form
            v-if="editingId === node.id"
            class="flex gap-1 px-2 pb-1"
            @submit.prevent="renameFolder(node)"
          >
            <input v-model="editingName" class="field h-7 text-label" />
            <button class="btn h-7 px-2 text-micro" type="submit">✓</button>
          </form>
          <ul v-if="!collapsed[node.id]" class="ml-3">
            <li v-for="child in node.children" :key="child.id">
              <div
                class="group flex items-center gap-1 px-2 py-1.5 transition-colors hover:bg-paper-2"
                :style="library.folderId === child.id ? 'background: var(--paper-2)' : ''"
              >
                <span class="w-3" />
                <button class="min-w-0 flex-1 truncate text-left text-label" @click="selectFolder(child.id)">{{ child.name }}</button>
                <span class="num text-micro text-ink-3 group-hover:hidden">{{ child.fileCount }}</span>
                <span class="hidden gap-1 group-hover:flex">
                  <button class="font-mono text-micro text-ink-3 hover:text-ink" @click="editingId = child.id; editingName = child.name">✎</button>
                  <button class="font-mono text-micro text-ink-3 hover:text-safelight" @click="removeFolder(child)">✕</button>
                </span>
              </div>
              <form v-if="editingId === child.id" class="flex gap-1 px-2 pb-1" @submit.prevent="renameFolder(child)">
                <input v-model="editingName" class="field h-7 text-label" />
                <button class="btn h-7 px-2 text-micro" type="submit">✓</button>
              </form>
            </li>
          </ul>
        </li>
      </ul>
      <p v-if="!library.tree.length && !creating" class="mt-2 font-mono text-micro text-ink-3">no folders yet</p>
    </section>

    <section class="border-b px-3 py-3">
      <p class="label">{{ t("library.tags") }}</p>
      <div class="mt-2 flex flex-wrap gap-1">
        <button
          v-for="tag in library.tags"
          :key="tag.id"
          class="chip"
          :class="library.activeTag === tag.name ? 'chip-on' : ''"
          @click="toggleTag(tag.name)"
        >
          {{ tag.name }}<span class="text-ink-3">{{ tag.fileCount }}</span>
        </button>
        <p v-if="!library.tags.length" class="font-mono text-micro text-ink-3">no tags yet</p>
      </div>
    </section>

    <section class="mt-auto px-3 py-3">
      <p class="label">{{ t("settings.quota") }}</p>
      <div class="mt-2 h-[3px] w-full" style="background: var(--paper-3)">
        <div class="h-full" :style="{ width: `${quota ? percent : 8}%`, background: percent > 90 ? 'var(--safelight)' : 'var(--ink)' }" />
      </div>
      <p class="num mt-1.5 text-micro text-ink-3">
        {{ humanBytes(used) }} {{ t("settings.used") }}
        <template v-if="quota">/ {{ humanBytes(quota) }}</template>
      </p>
    </section>
  </div>
</template>
