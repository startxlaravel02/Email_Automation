import { createRouter, createWebHistory } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: DashboardLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: 'Dashboard' },
        },
        {
          path: 'tracking',
          name: 'tracking',
          component: () => import('@/views/EmailTrackingView.vue'),
          meta: { title: 'Email Tracking' },
        },
        {
          path: 'recipients',
          name: 'recipients',
          component: () => import('@/views/RecipientActivityView.vue'),
          meta: { title: 'Recipient Activity' },
        },
        {
          path: 'leads',
          name: 'leads',
          component: () => import('@/views/LeadsView.vue'),
          meta: { title: 'Leads' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { title: 'Settings' },
        },
      ],
    },
  ],
})

export default router
