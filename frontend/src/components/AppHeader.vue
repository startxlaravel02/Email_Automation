<script setup>
import { Menu, Moon, Sun } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'

defineEmits(['toggle'])
const themeStore = useThemeStore()
</script>

<template>
  <header class="header">
    <button class="hamburger" aria-label="Open menu" @click="$emit('toggle')">
      <Menu :size="20" :stroke-width="2" />
    </button>

    <div class="header-right">
      <button
        class="icon-btn"
        :aria-label="themeStore.theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
        :title="themeStore.theme === 'dark' ? 'Light mode' : 'Dark mode'"
        @click="themeStore.toggle()"
      >
        <Sun v-if="themeStore.theme === 'dark'" :size="17" :stroke-width="2" />
        <Moon v-else :size="17" :stroke-width="2" />
      </button>
      <div class="avatar">SA</div>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: var(--header-h);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}
.hamburger {
  display: none;
  margin-right: auto;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
}
.hamburger:hover {
  background: var(--surface-2);
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
}
.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary-50);
  color: var(--primary-600);
  font-weight: 700;
  font-size: 11px;
  display: grid;
  place-items: center;
}
@media (max-width: 768px) {
  .hamburger {
    display: inline-flex;
  }
}
</style>
