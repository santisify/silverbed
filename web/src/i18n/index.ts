import { computed } from "vue";
import en from "./locales/en";
import zh from "./locales/zh";
import { useMetaStore } from "@/stores/meta";

type Dict = typeof en;

const dictionaries: Record<string, Dict> = { en, zh };

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  let node: unknown = dict;
  for (const part of parts) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function useI18n() {
  const metaStore = useMetaStore();
  const dict = computed<Dict>(() => dictionaries[metaStore.locale] ?? en);

  function t(path: string, vars?: Record<string, string | number>): string {
    const value = lookup(dict.value, path) ?? lookup(en, path) ?? path;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
  }

  return { t, locale: computed(() => metaStore.locale) };
}

export type { Dict };
