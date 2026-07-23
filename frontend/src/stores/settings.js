import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/services/api'

// Global AI auto-reply toggle (shared by the header/dashboard). Backed by the
// existing /api/dashboard/settings endpoints.
export const useSettingsStore = defineStore('settings', () => {
  const aiEnabled = ref(false)
  const loading = ref(false)

  async function fetchSettings() {
    const r = await api.get('/dashboard/settings')
    aiEnabled.value = !!r.aiEnabled
  }

  async function setAi(next) {
    loading.value = true
    try {
      const r = await api.post('/dashboard/settings', { aiEnabled: next })
      aiEnabled.value = !!r.aiEnabled
    } finally {
      loading.value = false
    }
  }

  return { aiEnabled, loading, fetchSettings, setAi }
})
