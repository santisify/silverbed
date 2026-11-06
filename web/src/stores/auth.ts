import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authApi, tokenStore, type User } from "@/api";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const ready = ref(false);
  const loading = ref(false);

  const isAuthenticated = computed(() => Boolean(user.value));
  const isAdmin = computed(() => user.value?.role === "admin");

  async function restore() {
    if (!tokenStore.get()) {
      ready.value = true;
      return;
    }
    try {
      const res = await authApi.me();
      user.value = res.user;
    } catch {
      tokenStore.set(null);
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string) {
    loading.value = true;
    try {
      const res = await authApi.login(username, password);
      tokenStore.set(res.token);
      user.value = res.user;
      return res.user;
    } finally {
      loading.value = false;
    }
  }

  async function register(username: string, password: string, email?: string) {
    loading.value = true;
    try {
      const res = await authApi.register(username, password, email);
      // Supabase may require email confirmation; there is no session yet.
      if (res.pendingConfirmation || !res.token) {
        return { pendingConfirmation: true } as const;
      }
      tokenStore.set(res.token);
      user.value = res.user ?? null;
      return res.user ?? null;
    } finally {
      loading.value = false;
    }
  }

  function acceptToken(token: string) {
    tokenStore.set(token);
    return restore();
  }

  async function refresh() {
    if (!tokenStore.get()) return null;
    const res = await authApi.me();
    user.value = res.user;
    return res.user;
  }

  function logout() {
    tokenStore.set(null);
    user.value = null;
  }

  return { user, ready, loading, isAuthenticated, isAdmin, restore, login, register, logout, refresh, acceptToken };
});
