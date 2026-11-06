<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { setupApi } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMetaStore } from "@/stores/meta";
import { useI18n } from "@/i18n";

const router = useRouter();
const auth = useAuthStore();
const meta = useMetaStore();
const { t } = useI18n();

const step = ref(1);
const form = reactive({ username: "admin", password: "", confirm: "", email: "", siteName: "Silverbed", siteDescription: "" });
const error = ref("");
const busy = ref(false);

onMounted(async () => {
  const status = await setupApi.status();
  if (status.installed) await router.replace("/login");
});

async function install() {
  error.value = "";
  if (form.password !== form.confirm) {
    error.value = "The two passwords do not match";
    return;
  }
  busy.value = true;
  try {
    const res = await setupApi.install({
      username: form.username,
      password: form.password,
      email: form.email || undefined,
      siteName: form.siteName,
      siteDescription: form.siteDescription,
    });
    await auth.acceptToken(res.token);
    await meta.load();
    await router.push("/app/library");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-paper px-4">
    <div class="w-full max-w-lg border bg-paper">
      <header class="border-b px-5 py-4">
        <p class="label">Silverbed · 01 / 01</p>
        <h1 class="mt-1 text-display">{{ t("setup.title") }}</h1>
        <p class="mt-2 text-label text-ink-2">{{ t("setup.lead") }}</p>
      </header>

      <form class="space-y-3 px-5 py-5" @submit.prevent="install">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="s-name">{{ t("auth.username") }}</label>
            <input id="s-name" v-model="form.username" class="field mt-1" required />
          </div>
          <div>
            <label class="label" for="s-mail">{{ t("auth.email") }} <span class="text-ink-3">({{ t("common.optional") }})</span></label>
            <input id="s-mail" v-model="form.email" class="field mt-1" type="email" />
          </div>
          <div>
            <label class="label" for="s-pass">{{ t("auth.password") }}</label>
            <input id="s-pass" v-model="form.password" class="field mt-1" type="password" required minlength="8" />
          </div>
          <div>
            <label class="label" for="s-confirm">{{ t("common.confirm") }}</label>
            <input id="s-confirm" v-model="form.confirm" class="field mt-1" type="password" required minlength="8" />
          </div>
        </div>

        <div class="border-t pt-3">
          <label class="label" for="s-site">{{ t("setup.siteName") }}</label>
          <input id="s-site" v-model="form.siteName" class="field mt-1" />
          <label class="label mt-3 block" for="s-desc">{{ t("setup.siteDescription") }}</label>
          <input id="s-desc" v-model="form.siteDescription" class="field mt-1" />
        </div>

        <p v-if="error" class="font-mono text-micro" style="color: var(--safelight)">{{ error }}</p>

        <button class="btn btn-primary w-full" type="submit" :disabled="busy">
          {{ busy ? t("common.loading") : t("setup.install") }}
        </button>
      </form>
    </div>
  </div>
</template>
