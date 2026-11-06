<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { authApi } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { dateTime, humanBytes } from "@/composables/format";

const auth = useAuthStore();
const meta = useMetaStore();
const ui = useUiStore();
const { t, locale } = useI18n();

const profile = reactive({
  email: auth.user?.email ?? "",
  defaultAccess: auth.user?.defaultAccess ?? "public",
});
const passwords = reactive({ current: "", next: "", confirm: "" });
const savingProfile = ref(false);
const savingPassword = ref(false);

const quotaPercent = computed(() => {
  const quota = auth.user?.storageQuota ?? 0;
  if (!quota) return null;
  return Math.min(100, ((auth.user?.storageUsed ?? 0) / quota) * 100);
});

async function saveProfile() {
  savingProfile.value = true;
  try {
    await authApi.updateProfile({ email: profile.email, defaultAccess: profile.defaultAccess });
    await auth.refresh();
    ui.success(t("toast.profileSaved"));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword() {
  if (passwords.next !== passwords.confirm) {
    ui.error("The new passwords do not match");
    return;
  }
  savingPassword.value = true;
  try {
    await authApi.changePassword(passwords.current, passwords.next);
    passwords.current = passwords.next = passwords.confirm = "";
    ui.success(t("toast.passwordChanged"));
  } catch (err) {
    ui.error((err as Error).message);
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-4">
    <h1 class="text-display">{{ t("settings.title") }}</h1>

    <section class="mt-4 border">
      <header class="border-b px-4 py-2"><p class="label">{{ t("settings.profile") }}</p></header>
      <div class="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <div>
          <p class="label">{{ t("auth.username") }}</p>
          <p class="mt-1 font-mono text-label">{{ auth.user?.username }}</p>
        </div>
        <div>
          <p class="label">{{ t("admin.role") }}</p>
          <p class="mt-1 text-label">{{ auth.user?.role }}</p>
        </div>
        <div>
          <label class="label" for="profile-email">{{ t("auth.email") }}</label>
          <input id="profile-email" v-model="profile.email" class="field mt-1" type="email" />
        </div>
        <div>
          <label class="label" for="profile-access">{{ t("settings.defaultAccess") }}</label>
          <select id="profile-access" v-model="profile.defaultAccess" class="field mt-1">
            <option value="public">{{ t("common.public") }}</option>
            <option value="private">{{ t("common.private") }}</option>
          </select>
        </div>
      </div>
      <footer class="flex justify-end border-t px-4 py-2">
        <button class="btn btn-primary" :disabled="savingProfile" @click="saveProfile">{{ t("common.save") }}</button>
      </footer>
    </section>

    <section class="mt-4 border">
      <header class="border-b px-4 py-2"><p class="label">{{ t("settings.quota") }}</p></header>
      <div class="px-4 py-4">
        <div class="flex items-baseline justify-between">
          <p class="num text-title">{{ humanBytes(auth.user?.storageUsed ?? 0) }}</p>
          <p class="num text-micro text-ink-3">
            {{ auth.user?.storageQuota ? `/ ${humanBytes(auth.user.storageQuota)}` : t("stats.unlimited") }}
          </p>
        </div>
        <div class="mt-2 h-[3px]" style="background: var(--paper-3)">
          <div class="h-full" :style="{ width: `${quotaPercent ?? 4}%`, background: 'var(--ink)' }" />
        </div>
        <p class="num mt-2 text-micro text-ink-3">
          {{ auth.user?.fileCount }} frames · {{ t("settings.memberSince") }} {{ dateTime(auth.user?.createdAt, locale) }}
        </p>
      </div>
    </section>

    <section class="mt-4 border">
      <header class="border-b px-4 py-2"><p class="label">{{ t("settings.security") }}</p></header>
      <div class="grid gap-4 px-4 py-4 sm:grid-cols-3">
        <div>
          <label class="label" for="pw-current">{{ t("settings.currentPassword") }}</label>
          <input id="pw-current" v-model="passwords.current" class="field mt-1" type="password" autocomplete="current-password" />
        </div>
        <div>
          <label class="label" for="pw-next">{{ t("settings.newPassword") }}</label>
          <input id="pw-next" v-model="passwords.next" class="field mt-1" type="password" autocomplete="new-password" />
        </div>
        <div>
          <label class="label" for="pw-confirm">{{ t("common.confirm") }}</label>
          <input id="pw-confirm" v-model="passwords.confirm" class="field mt-1" type="password" autocomplete="new-password" />
        </div>
      </div>
      <footer class="flex justify-end border-t px-4 py-2">
        <button class="btn btn-primary" :disabled="savingPassword || !passwords.current || !passwords.next" @click="savePassword">
          {{ t("common.save") }}
        </button>
      </footer>
    </section>

    <section class="mt-4 border">
      <header class="border-b px-4 py-2"><p class="label">{{ t("settings.appearance") }}</p></header>
      <div class="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <div>
          <p class="label">{{ t("settings.theme") }}</p>
          <div class="mt-1 flex gap-2">
            <button class="btn flex-1" :class="meta.theme === 'light' ? 'btn-primary' : ''" @click="meta.applyTheme('light')">{{ t("settings.light") }}</button>
            <button class="btn flex-1" :class="meta.theme === 'dark' ? 'btn-primary' : ''" @click="meta.applyTheme('dark')">{{ t("settings.dark") }}</button>
          </div>
        </div>
        <div>
          <p class="label">{{ t("settings.language") }}</p>
          <div class="mt-1 flex gap-2">
            <button class="btn flex-1" :class="meta.locale === 'en' ? 'btn-primary' : ''" @click="meta.setLocale('en')">English</button>
            <button class="btn flex-1" :class="meta.locale === 'zh' ? 'btn-primary' : ''" @click="meta.setLocale('zh')">简体中文</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
