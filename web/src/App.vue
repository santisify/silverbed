<script setup lang="ts">
import { onMounted } from "vue";
import { useMetaStore } from "@/stores/meta";
import { useAuthStore } from "@/stores/auth";
import ToastStack from "@/components/ToastStack.vue";

const meta = useMetaStore();
const auth = useAuthStore();

onMounted(async () => {
  try {
    await meta.load();
    if (!auth.ready) await auth.restore();
  } catch (err) {
    console.error("bootstrap failed", err);
  }
});
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition name="view-transition" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
  <ToastStack />
</template>
