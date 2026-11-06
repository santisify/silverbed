<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { authApi } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const meta = useMetaStore();
const ui = useUiStore();
const { t } = useI18n();

const mode = computed(() => (route.name === "register" ? "register" : "login"));
const form = reactive({ username: "", password: "", email: "" });
const error = ref("");
const providers = ref<{ github: boolean; google: boolean; supabaseLogin: boolean; loginWithEmail: boolean }>({
  github: false,
  google: false,
  supabaseLogin: false,
  loginWithEmail: false,
});

/** When Supabase verifies passwords the identifier is an email address. */
const identifierLabel = computed(() => (providers.value.loginWithEmail ? t("auth.email") : t("auth.username")));

void authApi.providers().then((p) => (providers.value = p)).catch(() => {});

async function submit() {
  error.value = "";
  try {
    if (mode.value === "login") {
      await auth.login(form.username.trim(), form.password);
    } else {
      if (providers.value.loginWithEmail && !form.email.trim()) {
        error.value = t("auth.emailRequired");
        return;
      }
      const res = await auth.register(form.username.trim(), form.password, form.email || undefined);
      if (res && "pendingConfirmation" in res) {
        error.value = t("auth.confirmEmail");
        return;
      }
    }
    await meta.load();
    const redirect = String(route.query.redirect ?? "/app/library");
    await router.push(redirect);
    ui.success(t("auth.welcomeBack"), auth.user?.username);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function oauth(provider: "github" | "google") {
  window.location.href = `/api/v1/oauth/${provider}/start?redirect=/app/library`;
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <!-- poster side -->
    <section class="relative hidden flex-col justify-between border-r bg-paper p-10 lg:flex">
      <div class="sheet-grid absolute inset-0 opacity-60" />
      <div class="relative flex items-center gap-2">
        <span class="flex h-7 w-10 items-center justify-center border border-ink">
          <span class="h-3 w-3 rounded-full border border-safelight"></span>
        </span>
        <span class="text-label font-semibold">{{ meta.meta?.siteName ?? "Silverbed" }}</span>
      </div>

      <div class="relative">
        <p class="label">{{ t("landing.tagline") }}</p>
        <h1 class="mt-3 text-poster">{{ mode === "login" ? t("auth.signInTitle") : t("auth.registerTitle") }}</h1>
        <div class="mt-8 flex items-end gap-6">
          <div>
            <p class="num text-display">{{ meta.meta?.totals.files ?? 0 }}</p>
            <p class="label mt-1">{{ t("landing.statsFiles") }}</p>
          </div>
          <div>
            <p class="num text-display">{{ ((meta.meta?.totals.bytes ?? 0) / 1024 / 1024).toFixed(1) }}</p>
            <p class="label mt-1">MB {{ t("landing.statsBytes") }}</p>
          </div>
        </div>
      </div>

      <p class="relative max-w-sm text-meta text-ink-3">{{ meta.meta?.siteDescription }}</p>
    </section>

    <!-- form side -->
    <section class="flex flex-col justify-center px-6 py-12">
      <div class="mx-auto w-full max-w-sm">
        <h2 class="text-title">{{ mode === "login" ? t("auth.signInTitle") : t("auth.registerTitle") }}</h2>

        <form class="mt-6 space-y-3" @submit.prevent="submit">
          <div>
            <label class="label" for="auth-user">{{ identifierLabel }}</label>
            <input
              id="auth-user"
              v-model="form.username"
              class="field mt-1"
              type="text"
              :inputmode="providers.loginWithEmail ? 'email' : 'text'"
              :autocomplete="providers.loginWithEmail ? 'email' : 'username'"
              required
            />
          </div>
          <div v-if="mode === 'register'">
            <label class="label" for="auth-email">
              {{ t("auth.email") }}
              <span v-if="!providers.loginWithEmail" class="text-ink-3">({{ t("common.optional") }})</span>
            </label>
            <input id="auth-email" v-model="form.email" class="field mt-1" type="email" autocomplete="email" />
          </div>
          <div>
            <label class="label" for="auth-pass">{{ t("auth.password") }}</label>
            <input
              id="auth-pass"
              v-model="form.password"
              class="field mt-1"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              required
            />
          </div>

          <p v-if="error" class="font-mono text-micro" style="color: var(--safelight)">{{ error }}</p>

          <button class="btn btn-primary w-full" type="submit" :disabled="auth.loading">
            {{ auth.loading ? t("common.loading") : mode === "login" ? t("common.signIn") : t("common.register") }}
          </button>
        </form>

        <template v-if="providers.github || providers.google">
          <div class="my-4 flex items-center gap-3">
            <span class="h-px flex-1 bg-rule" />
            <span class="label">{{ t("auth.orContinue") }}</span>
            <span class="h-px flex-1 bg-rule" />
          </div>
          <div class="flex gap-2">
            <button v-if="providers.github" class="btn flex-1" @click="oauth('github')">GitHub</button>
            <button v-if="providers.google" class="btn flex-1" @click="oauth('google')">Google</button>
          </div>
        </template>

        <p class="mt-6 text-meta text-ink-2">
          {{ mode === "login" ? t("auth.noAccount") : t("auth.haveAccount") }}
          <RouterLink class="link ml-1" :to="{ name: mode === 'login' ? 'register' : 'login' }">
            {{ mode === "login" ? t("common.register") : t("common.signIn") }}
          </RouterLink>
        </p>
        <RouterLink class="mt-4 block font-mono text-micro text-ink-3 hover:text-ink" to="/">← {{ t("common.back") }}</RouterLink>
      </div>
    </section>
  </div>
</template>
