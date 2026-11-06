import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "landing", component: () => import("@/views/LandingView.vue"), meta: { public: true, bare: true } },
    { path: "/login", name: "login", component: () => import("@/views/AuthView.vue"), meta: { public: true, bare: true, mode: "login" } },
    { path: "/register", name: "register", component: () => import("@/views/AuthView.vue"), meta: { public: true, bare: true, mode: "register" } },
    { path: "/setup", name: "setup", component: () => import("@/views/SetupView.vue"), meta: { public: true, bare: true } },
    { path: "/s/:token", name: "share", component: () => import("@/views/PublicShareView.vue"), meta: { public: true, bare: true } },
    { path: "/gallery", name: "gallery", component: () => import("@/views/GalleryView.vue"), meta: { public: true, bare: true } },
    {
      path: "/app",
      component: () => import("@/layouts/AppLayout.vue"),
      children: [
        { path: "", redirect: "/app/library" },
        { path: "library", name: "library", component: () => import("@/views/LibraryView.vue"), meta: { auth: true } },
        { path: "upload", name: "upload", component: () => import("@/views/UploadView.vue"), meta: { auth: true } },
        { path: "stats", name: "stats", component: () => import("@/views/StatsView.vue"), meta: { auth: true } },
        { path: "shares", name: "shares", component: () => import("@/views/SharesView.vue"), meta: { auth: true } },
        { path: "keys", name: "keys", component: () => import("@/views/KeysView.vue"), meta: { auth: true } },
        { path: "settings", name: "settings", component: () => import("@/views/SettingsView.vue"), meta: { auth: true } },
        { path: "admin", name: "admin", component: () => import("@/views/AdminView.vue"), meta: { auth: true, admin: true } },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.restore();

  if (to.meta.auth && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.meta.admin && !auth.isAdmin) {
    return { name: "library" };
  }
  if (to.meta.bare && to.name !== "share" && to.name !== "setup" && auth.isAuthenticated && (to.name === "login" || to.name === "register")) {
    return { name: "library" };
  }
  return true;
});

export default router;
