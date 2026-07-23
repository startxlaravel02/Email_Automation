<script setup>
import { Menu } from 'lucide-vue-next'

defineEmits(['toggle'])
</script>

<template>
  <header class="header">
    <button class="hamburger" aria-label="Open menu" @click="$emit('toggle')">
      <Menu :size="20" :stroke-width="2" />
    </button>
    <div class="avatar">SA</div>
  </header>
</template>

<style scoped>
.header {
  height: var(--header-h);
  display: flex;
  align-items: center;
  justify-content: flex-end; /* avatar sits right */
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}
.hamburger {
  display: none; /* desktop: hidden */
  margin-right: auto; /* mobile: pushes it to the left, avatar stays right */
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
