import { createApp } from "vue";
import { createPinia } from "pinia";
import "@fontsource-variable/archivo";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/main.css";
import App from "./App.vue";
import router from "./router";
import { setUnauthorizedHandler } from "./api/client";
import { useAuthStore } from "./stores/auth";
import { useUiStore } from "./stores/ui";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

setUnauthorizedHandler(() => {
  const auth = useAuthStore(pinia);
  const ui = useUiStore(pinia);
  if (auth.isAuthenticated) {
    auth.logout();
    ui.info("Session ended", "Sign in again to keep working.");
    void router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
  }
});

app.mount("#app");
