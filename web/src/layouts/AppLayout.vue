<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useLibraryStore } from "@/stores/library";
import { useI18n } from "@/i18n";
import SideRail from "@/components/SideRail.vue";

const auth = useAuthStore();
const meta = useMetaStore();
const library = useLibraryStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const railOpen = ref(false);

const nav = computed(() => {
  const items = [
    { name: "library", label: t("nav.library") },
    { name: "gallery", label: t("nav.gallery") },
    { name: "upload", label: t("nav.upload") },
    { name: "stats", label: t("nav.stats") },
    { name: "shares", label: t("nav.shares") },
    { name: "keys", label: t("nav.keys") },
    { name: "settings", label: t("nav.settings") },
  ];
  if (auth.isAdmin) items.push({ name: "admin", label: t("nav.admin") });
  return items;
});

function signOut() {
  auth.logout();
  library.clearSelection();
  void router.push({ name: "landing" });
}
</script>

<template>
  <div class="min-h-screen bg-paper">
    <header class="sticky top-0 z-40 border-b bg-paper">
      <div class="flex h-14 items-center gap-4 px-4">
        <button class="btn btn-ghost lg:hidden" @click="railOpen = !railOpen">☰</button>
        <RouterLink to="/app/library" class="flex items-center gap-2">
          <span class="flex h-6 w-8 items-center justify-center border border-ink">
            <span class="h-2.5 w-2.5 rounded-full border border-safelight"></span>
          </span>
          <span class="text-label font-semibold tracking-tight">{{ meta.meta?.siteName ?? "Silverbed" }}</span>
        </RouterLink>

        <nav class="hidden items-center gap-1 lg:flex">
          <RouterLink
            v-for="item in nav"
            :key="item.name"
            :to="{ name: item.name }"
            class="px-2 py-1 text-label text-ink-2 transition-colors hover:text-ink"
            :class="route.name === item.name ? 'text-ink' : ''"
            :style="route.name === item.name ? 'box-shadow: inset 0 -2px 0 var(--safelight)' : ''"
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <button class="btn btn-ghost h-8 px-2 font-mono text-micro" :title="t('settings.language')" @click="meta.setLocale(meta.locale === 'zh' ? 'en' : 'zh')">
            {{ meta.locale === "zh" ? "中文" : "EN" }}
          </button>
          <button class="btn btn-ghost h-8 px-2 font-mono text-micro" :title="t('settings.theme')" @click="meta.toggleTheme()">
            {{ meta.theme === "dark" ? "◐" : "◑" }}
          </button>
          <RouterLink :to="{ name: 'upload' }" class="btn btn-primary h-8">{{ t("common.upload") }}</RouterLink>
          <div class="hidden items-center gap-2 border-l pl-3 sm:flex">
            <span class="font-mono text-micro text-ink-2">{{ auth.user?.username }}</span>
            <button class="btn btn-ghost h-8 px-2 text-micro" @click="signOut">{{ t("common.signOut") }}</button>
          </div>
        </div>
      </div>
      <div v-if="meta.meta?.announcement" class="border-t bg-paper-2 px-4 py-1.5 text-label text-ink-2">
        {{ meta.meta.announcement }}
      </div>
    </header>

    <div class="flex min-h-[calc(100vh-3.5rem)]">
      <aside
        class="fixed inset-y-14 left-0 z-30 w-[16rem] shrink-0 overflow-y-auto border-r bg-paper transition-transform lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0"
        :class="railOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
      >
        <SideRail />
      </aside>

      <main class="min-w-0 flex-1">
        <RouterView v-slot="{ Component }">
          <Transition name="view-transition" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
