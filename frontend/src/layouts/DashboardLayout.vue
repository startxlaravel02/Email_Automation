<script setup>
import { ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'

const sidebarOpen = ref(false)
const route = useRoute()

// Close the mobile drawer whenever the route changes (a nav item was tapped).
watch(() => route.fullPath, () => (sidebarOpen.value = false))
</script>

<template>
  <div class="layout">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />

    <!-- Mobile-only dimmed backdrop behind the open drawer. -->
    <div v-if="sidebarOpen" class="backdrop" @click="sidebarOpen = false"></div>

    <div class="main">
      <AppHeader @toggle="sidebarOpen = !sidebarOpen" />
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  padding: 24px;
  overflow-x: hidden;
}
.backdrop {
  display: none;
}
@media (max-width: 768px) {
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(16, 24, 40, 0.45);
  }
  .content {
    padding: 16px;
  }
}
</style>
