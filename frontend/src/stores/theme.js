import { defineStore } from 'pinia'
import { ref } from 'vue'

// Light/dark theme, persisted to localStorage. Default = light.
export const useThemeStore = defineStore('theme', () => {
  const theme = ref(localStorage.getItem('theme') || 'light')

  function apply() {
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('theme', theme.value)
    apply()
  }

  apply()
  return { theme, toggle }
})
