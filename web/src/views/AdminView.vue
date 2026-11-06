<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { adminApi, type AdminOverview, type Paginated, type User } from "@/api";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "@/i18n";
import { dateTime, humanBytes, relativeTime } from "@/composables/format";
import Sparkline from "@/components/Sparkline.vue";
import StatBlock from "@/components/StatBlock.vue";
import ModalDialog from "@/components/ModalDialog.vue";

const ui = useUiStore();
const auth = useAuthStore();
const { t, locale } = useI18n();

type Tab = "overview" | "users" | "settings" | "activity" | "mail";
const tab = ref<Tab>("overview");

const overview = ref<AdminOverview | null>(null);
const users = ref<Paginated<User> | null>(null);
const settings = ref<Record<string, string>>({});
const activity = ref<Paginated<{ id: string; action: string; username: string | null; target: string | null; detail: string | null; ip: string | null; createdAt: string }> | null>(null);
const mails = ref<{ id: string; to: string; subject: string; body: string; transport: string; error: string | null; createdAt: string }[]>([]);
const loading = ref(true);

const showUser = ref(false);
const newUser = reactive({ username: "", password: "", email: "", role: "user", storageQuota: 0 });
const editing = ref<User | null>(null);

const userSearch = ref("");

const days = computed(() => {
  const rows = overview.value?.timeline ?? [];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; uploads: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: date, uploads: byDay.get(date)?.uploads ?? 0 });
  }
  return out;
});

const uptime = computed(() => {
  const seconds = overview.value?.system.uptimeSeconds ?? 0;
  return t("admin.uptimeFormat", { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) });
});

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [o, u, s, a, m] = await Promise.all([
      adminApi.overview(),
      adminApi.users(),
      adminApi.settings(),
      adminApi.activity(),
      adminApi.mail(),
    ]);
    overview.value = o;
    users.value = u;
    settings.value = s;
    activity.value = a;
    mails.value = m;
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function searchUsers() {
  users.value = await adminApi.users({ q: userSearch.value || undefined });
}

async function createUser() {
  try {
    await adminApi.createUser({
      username: newUser.username,
      password: newUser.password,
      email: newUser.email || undefined,
      role: newUser.role,
      storageQuota: Number(newUser.storageQuota) || 0,
    });
    showUser.value = false;
    newUser.username = newUser.password = newUser.email = "";
    newUser.role = "user";
    newUser.storageQuota = 0;
    await searchUsers();
    ui.success("User created");
  } catch (err) {
    ui.error((err as Error).message);
  }
}

async function patchUser(user: User, body: Record<string, unknown>) {
  try {
    await adminApi.updateUser(user.id, body as never);
    await searchUsers();
    ui.success(t("toast.saved"));
  } catch (err) {
    ui.error((err as Error).message);
  }
}

async function deleteUser(user: User) {
  if (!confirm(`${t("common.delete")} ${user.username}?`)) return;
  await adminApi.deleteUser(user.id);
  await searchUsers();
}

async function saveSettings() {
  try {
    settings.value = await adminApi.updateSettings(settings.value);
    ui.success(t("toast.settingsSaved"));
  } catch (err) {
    ui.error((err as Error).message);
  }
}

const testMailTo = ref("");
async function sendTestMail() {
  try {
    const res = await adminApi.testMail(testMailTo.value);
    ui.success(t("admin.mailSent", { transport: res.transport }));
    mails.value = await adminApi.mail();
  } catch (err) {
    ui.error((err as Error).message);
  }
}

async function purgeTrash() {
  const res = await adminApi.purgeTrash();
  ui.success(t("admin.purged", { n: res.purged }));
  await load();
}

async function expireFiles() {
  const res = await adminApi.expire();
  ui.success(`Expired ${res.expired} file(s)`);
  await load();
}
</script>

<template>
  <div class="px-4 py-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-display">{{ t("admin.title") }}</h1>
        <p class="mt-1 text-label text-ink-2">{{ overview?.system.publicBaseUrl }} · {{ overview?.system.runtime }}</p>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink :to="{ name: 'gallery' }" class="btn h-7 text-micro">{{ t("admin.manageImages") }}</RouterLink>
        <div class="flex gap-1 border p-1">
          <button
            v-for="option in (['overview', 'users', 'settings', 'activity', 'mail'] as Tab[])"
            :key="option"
            class="px-2 py-1 text-label"
            :style="tab === option ? 'background: var(--ink); color: var(--paper)' : ''"
            @click="tab = option"
          >
            {{ t(`admin.${option}`) }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="mt-4 border px-4 py-16 text-center font-mono text-micro text-ink-3">{{ t("common.loading") }}…</div>

    <template v-else-if="overview">
      <template v-if="tab === 'overview'">
        <div class="mt-4 grid grid-cols-2 border border-b-0 md:grid-cols-5">
          <StatBlock :label="t('admin.files')" :value="overview.totals.files" :hint="humanBytes(overview.totals.bytes)" />
          <StatBlock :label="t('admin.users')" :value="overview.totals.users" :hint="`${overview.totals.disabledUsers} disabled`" />
          <StatBlock :label="t('admin.shares')" :value="overview.totals.shares" :hint="`${overview.totals.shareViews} views`" />
          <StatBlock :label="t('admin.trash')" :value="overview.totals.trashed" />
          <StatBlock :label="t('admin.accessEvents')" :value="overview.totals.accessEvents" />
        </div>

        <section class="grid gap-0 border md:grid-cols-[1.5fr_1fr]">
          <div class="border-r p-4">
            <p class="label">{{ t("stats.uploads30") }}</p>
            <div class="mt-4"><Sparkline :values="days.map((d) => d.uploads)" :height="80" /></div>
            <div class="mt-1 flex justify-between font-mono text-micro text-ink-3">
              <span>{{ days[0]?.day }}</span>
              <span>{{ days[days.length - 1]?.day }}</span>
            </div>

            <p class="label mt-5">{{ t("stats.top") }}</p>
            <ul class="mt-2 divide-y">
              <li v-for="user in overview.topUploaders" :key="user.id" class="flex items-center justify-between py-1.5">
                <span class="text-label">{{ user.username }}</span>
                <span class="num text-micro text-ink-3">{{ user.files }} files · {{ humanBytes(user.bytes) }}</span>
              </li>
            </ul>
          </div>

          <div class="p-4">
            <p class="label">{{ t("admin.runtime") }}</p>
            <dl class="mt-2 space-y-1.5">
              <div class="flex justify-between"><dt class="label">{{ t("admin.driver") }}</dt><dd class="num text-meta">{{ overview.system.storageDriver }}</dd></div>
              <div class="flex justify-between"><dt class="label">{{ t("admin.database") }}</dt><dd class="num text-meta">{{ overview.system.database }}</dd></div>
              <div class="flex justify-between"><dt class="label">{{ t("admin.authMode") }}</dt><dd class="num text-meta">{{ overview.system.authMode }}</dd></div>
              <div class="flex justify-between"><dt class="label">{{ t("admin.smtp") }}</dt><dd class="num text-meta">{{ overview.system.smtp ? "configured" : "console" }}</dd></div>
              <div class="flex justify-between"><dt class="label">{{ t("admin.uptime") }}</dt><dd class="num text-meta">{{ uptime }}</dd></div>
              <div class="flex justify-between"><dt class="label">{{ t("admin.memory") }}</dt><dd class="num text-meta">{{ overview.system.memoryMb }} MB</dd></div>
            </dl>

            <p class="label mt-5">{{ t("admin.maintenance") }}</p>
            <div class="mt-2 flex flex-col gap-1">
              <button class="btn h-7 text-micro" @click="purgeTrash">{{ t("admin.purgeTrash") }}</button>
              <button class="btn h-7 text-micro" @click="expireFiles">{{ t("admin.expireFiles") }}</button>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="tab === 'users'">
        <div class="mt-4 flex items-center gap-2">
          <form class="flex-1" @submit.prevent="searchUsers">
            <input v-model="userSearch" class="field h-8" :placeholder="t('common.search')" type="search" />
          </form>
          <button class="btn btn-primary h-8" @click="showUser = true">{{ t("admin.newUser") }}</button>
        </div>

        <div class="mt-2 border">
          <div class="hidden grid-cols-[1.4fr_1.4fr_5rem_6rem_1fr_9rem] gap-3 border-b px-3 py-2 md:grid">
            <span class="label">{{ t("auth.username") }}</span>
            <span class="label">{{ t("auth.email") }}</span>
            <span class="label">{{ t("admin.role") }}</span>
            <span class="label">{{ t("admin.status") }}</span>
            <span class="label">{{ t("settings.quota") }}</span>
            <span class="label text-right">actions</span>
          </div>
          <div v-for="user in users?.items ?? []" :key="user.id" class="grid gap-3 border-b px-3 py-2 last:border-b-0 md:grid-cols-[1.4fr_1.4fr_5rem_6rem_1fr_9rem]">
            <div class="min-w-0">
              <p class="truncate text-label">{{ user.username }}</p>
              <p class="num text-micro text-ink-3">{{ user.fileCount }} files · {{ humanBytes(user.storageUsed) }}</p>
            </div>
            <span class="truncate text-micro text-ink-2">{{ user.email || "—" }}</span>
            <select class="field h-7 w-auto text-micro" :value="user.role" :disabled="user.id === auth.user?.id" @change="patchUser(user, { role: ($event.target as HTMLSelectElement).value })">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <select class="field h-7 w-auto text-micro" :value="user.status" :disabled="user.id === auth.user?.id" @change="patchUser(user, { status: ($event.target as HTMLSelectElement).value })">
              <option value="active">{{ t("admin.active") }}</option>
              <option value="disabled">{{ t("admin.disabled") }}</option>
            </select>
            <span class="num text-micro text-ink-3">{{ user.storageQuota ? humanBytes(user.storageQuota) : "∞" }}</span>
            <div class="flex items-center justify-end gap-1">
              <button class="btn h-7 px-2 text-micro" @click="editing = user">{{ t("common.edit") }}</button>
              <button class="btn btn-danger h-7 px-2 text-micro" :disabled="user.id === auth.user?.id" @click="deleteUser(user)">✕</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'settings'">
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <section class="border">
            <header class="border-b px-4 py-2"><p class="label">{{ t("admin.instanceSettings") }}</p></header>
            <div class="space-y-3 px-4 py-4">
              <div>
                <label class="label" for="set-name">{{ t("admin.siteName") }}</label>
                <input id="set-name" v-model="settings.site_name" class="field mt-1" />
              </div>
              <div>
                <label class="label" for="set-desc">{{ t("admin.siteDescription") }}</label>
                <input id="set-desc" v-model="settings.site_description" class="field mt-1" />
              </div>
              <div>
                <label class="label" for="set-announce">{{ t("admin.announcement") }}</label>
                <input id="set-announce" v-model="settings.announcement" class="field mt-1" />
              </div>
              <label class="flex items-center gap-2 text-label">
                <input type="checkbox" class="h-3.5 w-3.5" :checked="settings.allow_register === 'true'" @change="settings.allow_register = ($event.target as HTMLInputElement).checked ? 'true' : 'false'" />
                {{ t("admin.allowRegister") }}
              </label>
              <label class="flex items-center gap-2 text-label">
                <input type="checkbox" class="h-3.5 w-3.5" :checked="settings.guest_upload === 'true'" @change="settings.guest_upload = ($event.target as HTMLInputElement).checked ? 'true' : 'false'" />
                {{ t("admin.guestUpload") }}
              </label>
            </div>
          </section>

          <section class="border">
            <header class="border-b px-4 py-2"><p class="label">{{ t("admin.storage") }}</p></header>
            <div class="space-y-3 px-4 py-4">
              <div>
                <label class="label" for="set-max">{{ t("admin.maxUpload") }}</label>
                <input id="set-max" v-model="settings.max_upload_mb" class="field mt-1" type="number" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="set-thumb">{{ t("admin.thumbSize") }}</label>
                  <input id="set-thumb" v-model="settings.thumb_size" class="field mt-1" type="number" />
                </div>
                <div>
                  <label class="label" for="set-preview">{{ t("admin.previewSize") }}</label>
                  <input id="set-preview" v-model="settings.preview_size" class="field mt-1" type="number" />
                </div>
              </div>
              <div>
                <label class="label" for="set-watermark">{{ t("admin.watermark") }}</label>
                <input id="set-watermark" v-model="settings.watermark_text" class="field mt-1" />
              </div>
              <label class="flex items-center gap-2 text-label">
                <input type="checkbox" class="h-3.5 w-3.5" :checked="settings.hotlink_protect === 'true'" @change="settings.hotlink_protect = ($event.target as HTMLInputElement).checked ? 'true' : 'false'" />
                {{ t("admin.hotlink") }}
              </label>
              <div>
                <label class="label" for="set-domains">{{ t("admin.allowedDomains") }}</label>
                <input id="set-domains" v-model="settings.allowed_domains" class="field mt-1" placeholder="example.com, blog.example.com" />
                <p class="mt-1 font-mono text-micro text-ink-3">{{ t("admin.allowedDomainsHint") }}</p>
              </div>
            </div>
            <footer class="flex justify-end border-t px-4 py-2">
              <button class="btn btn-primary" @click="saveSettings">{{ t("common.save") }}</button>
            </footer>
          </section>
        </div>
      </template>

      <template v-else-if="tab === 'activity'">
        <div class="mt-4 border">
          <div class="grid grid-cols-[10rem_1fr_1fr_9rem] gap-3 border-b px-3 py-2">
            <span class="label">action</span>
            <span class="label">actor</span>
            <span class="label">target</span>
            <span class="label text-right">when</span>
          </div>
          <div v-for="row in activity?.items ?? []" :key="row.id" class="grid grid-cols-[10rem_1fr_1fr_9rem] gap-3 border-b px-3 py-2 last:border-b-0">
            <span class="font-mono text-micro">{{ row.action }}</span>
            <span class="truncate text-micro text-ink-2">{{ row.username ?? "—" }} <span class="text-ink-3">{{ row.ip }}</span></span>
            <span class="truncate text-micro text-ink-2">{{ row.target || row.detail || "—" }}</span>
            <span class="num text-right text-micro text-ink-3">{{ relativeTime(row.createdAt) }}</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="mt-4 flex items-end gap-2">
          <div class="flex-1">
            <label class="label" for="mail-to">{{ t("admin.mailTo") }}</label>
            <input id="mail-to" v-model="testMailTo" class="field mt-1" type="email" placeholder="you@example.com" />
          </div>
          <button class="btn btn-primary" :disabled="!testMailTo" @click="sendTestMail">{{ t("admin.testMail") }}</button>
        </div>

        <div class="mt-3 border">
          <div v-for="mail in mails" :key="mail.id" class="border-b px-3 py-2 last:border-b-0">
            <div class="flex items-center justify-between">
              <p class="text-label">{{ mail.subject }}</p>
              <div class="flex items-center gap-2">
                <span class="chip">{{ mail.transport }}</span>
                <span class="num text-micro text-ink-3">{{ dateTime(mail.createdAt, locale) }}</span>
              </div>
            </div>
            <p class="num text-micro text-ink-3">to {{ mail.to }}</p>
            <pre class="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-micro text-ink-2">{{ mail.body }}</pre>
            <p v-if="mail.error" class="mt-1 font-mono text-micro" style="color: var(--safelight)">{{ mail.error }}</p>
          </div>
          <p v-if="!mails.length" class="px-3 py-10 text-center font-mono text-micro text-ink-3">{{ t("admin.noMail") }}</p>
        </div>
      </template>
    </template>

    <ModalDialog v-if="showUser" :title="t('admin.newUser')" @close="showUser = false">
      <div class="space-y-3">
        <div>
          <label class="label" for="nu-name">{{ t("auth.username") }}</label>
          <input id="nu-name" v-model="newUser.username" class="field mt-1" />
        </div>
        <div>
          <label class="label" for="nu-pass">{{ t("auth.password") }}</label>
          <input id="nu-pass" v-model="newUser.password" class="field mt-1" type="password" />
        </div>
        <div>
          <label class="label" for="nu-mail">{{ t("auth.email") }}</label>
          <input id="nu-mail" v-model="newUser.email" class="field mt-1" type="email" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="nu-role">{{ t("admin.role") }}</label>
            <select id="nu-role" v-model="newUser.role" class="field mt-1">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label class="label" for="nu-quota">{{ t("admin.quota") }}</label>
            <input id="nu-quota" v-model.number="newUser.storageQuota" class="field mt-1" type="number" min="0" />
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="showUser = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" :disabled="!newUser.username || !newUser.password" @click="createUser">{{ t("common.create") }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="editing" :title="editing.username" @close="editing = null">
      <div class="space-y-3">
        <div>
          <label class="label" for="eu-mail">{{ t("auth.email") }}</label>
          <input id="eu-mail" v-model="editing.email" class="field mt-1" type="email" />
        </div>
        <div>
          <label class="label" for="eu-quota">{{ t("admin.quota") }}</label>
          <input id="eu-quota" v-model.number="editing.storageQuota" class="field mt-1" type="number" min="0" />
        </div>
        <div>
          <label class="label" for="eu-pass">{{ t("admin.resetPassword") }}</label>
          <input id="eu-pass" v-model="(editing as any).newPassword" class="field mt-1" type="password" placeholder="leave empty to keep" />
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="editing = null">{{ t("common.cancel") }}</button>
        <button
          class="btn btn-primary"
          @click="
            patchUser(editing!, {
              email: editing!.email ?? '',
              storageQuota: editing!.storageQuota,
              password: (editing as any).newPassword || undefined,
            });
            editing = null;
          "
        >
          {{ t("common.save") }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
