<script setup>
import { RouterLink, useRoute } from 'vue-router'
import { LayoutDashboard, ScrollText, Activity, Users, Target, Settings, X } from 'lucide-vue-next'

defineProps({ open: Boolean })
defineEmits(['close'])

const route = useRoute()

// Active when the current path matches the nav item (or is a child of it, e.g.
// /recipients/:email keeps "Recipient Activity" active). The conversation detail
// page (/conversations/:id) matches nothing here, so no item is highlighted there.
function isActive(to) {
  const p = route.path
  return p === to || p.startsWith(to + '/')
}

// Nav is data-driven so adding a page later = one line here.
const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/activity', label: 'Activity Log', icon: ScrollText },
  { to: '/tracking', label: 'Email Tracking', icon: Activity },
  { to: '/recipients', label: 'Recipient Activity', icon: Users },
  { to: '/leads', label: 'Leads', icon: Target },
  { to: '/settings', label: 'Settings', icon: Settings },
]
</script>

<template>
  <aside class="sidebar" :class="{ open }">
    <div class="brand">
      <div class="brand-mark">EA</div>
      <span class="brand-name">Email Automation</span>
      <button class="sidebar-close" aria-label="Close menu" @click="$emit('close')">
        <X :size="18" :stroke-width="2" />
      </button>
    </div>

    <div class="nav-section section-label">Menu</div>
    <nav class="nav">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: isActive(item.to) }"
      >
        <component :is="item.icon" :size="18" :stroke-width="2" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-foot">
      <div class="avatar">SA</div>
      <div class="who">
        <div class="who-name">Super Admin</div>
        <div class="who-role muted">Signed in</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  height: 100vh;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  position: sticky;
  top: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 8px 14px;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  display: grid;
  place-items: center;
}
.brand-name {
  font-weight: 700;
  font-size: var(--fs-sm);
  flex: 1;
}
.sidebar-close {
  display: none; /* desktop: hidden — shown only in the mobile drawer */
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
}
.sidebar-close:hover {
  background: var(--surface-2);
}
.nav-section {
  padding: 6px 8px 4px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
.nav-item.active {
  background: var(--primary-50);
  color: var(--primary-600);
  font-weight: 600;
}
.sidebar-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-top: 1px solid var(--border);
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--primary-50);
  color: var(--primary-600);
  font-weight: 700;
  font-size: 11px;
  display: grid;
  place-items: center;
}
.who-name {
  font-size: var(--fs-sm);
  font-weight: 600;
}
.who-role {
  font-size: var(--fs-xs);
}

/* Mobile: sidebar becomes a slide-in drawer toggled by the header hamburger. */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
  }
  .sidebar.open {
    transform: translateX(0);
    box-shadow: 2px 0 20px rgba(16, 24, 40, 0.14);
  }
  .sidebar-close {
    display: inline-flex;
  }
}
</style>
