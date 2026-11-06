import { defineStore } from "pinia";
import { ref } from "vue";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
}

let nextId = 1;

export const useUiStore = defineStore("ui", () => {
  const toasts = ref<Toast[]>([]);
  const inspectorOpen = ref(false);

  function push(kind: Toast["kind"], message: string, detail?: string) {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, kind, message, detail }];
    setTimeout(() => dismiss(id), kind === "error" ? 6500 : 3600);
    return id;
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    inspectorOpen,
    dismiss,
    info: (m: string, d?: string) => push("info", m, d),
    success: (m: string, d?: string) => push("success", m, d),
    error: (m: string, d?: string) => push("error", m, d),
  };
});
