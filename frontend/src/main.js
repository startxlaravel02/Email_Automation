import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@fontsource-variable/inter' // self-hosted Inter (family: "Inter Variable")
import '@fontsource-variable/jetbrains-mono' // self-hosted mono for numbers (family: "JetBrains Mono Variable")
import './assets/theme.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
