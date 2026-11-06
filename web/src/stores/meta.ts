import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { metaApi, type Meta } from "@/api";

export type Theme = "light" | "dark";
export type Locale = "en" | "zh";

const THEME_KEY = "sb.theme";
const LOCALE_KEY = "sb.locale";

export const useMetaStore = defineStore("meta", () => {
  const meta = ref<Meta | null>(null);
  const theme = ref<Theme>((localStorage.getItem(THEME_KEY) as Theme) ?? "light");
  const locale = ref<Locale>(((localStorage.getItem(LOCALE_KEY) as Locale) ?? navigator.language.startsWith("zh")) ? "zh" : "en");

  const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
  locale.value = stored ?? (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");

  function applyTheme(next: Theme) {
    theme.value = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  }

  function toggleTheme() {
    applyTheme(theme.value === "light" ? "dark" : "light");
  }

  function setLocale(next: Locale) {
    locale.value = next;
    localStorage.setItem(LOCALE_KEY, next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  }

  async function load() {
    meta.value = await metaApi.get();
    document.title = meta.value.siteName;
    return meta.value;
  }

  applyTheme(theme.value);
  document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
  watch(theme, (next) => applyTheme(next));

  return { meta, theme, locale, load, toggleTheme, setLocale, applyTheme };
});
