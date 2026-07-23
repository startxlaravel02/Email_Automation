<script setup>
import { onMounted, ref } from 'vue'
import { api } from '@/services/api'
import ActivityTable from '@/components/ActivityTable.vue'

const rows = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/dashboard/emails?limit=100')
    rows.value = r.emails || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">Activity Log</div>
        <div class="page-subtitle">Every processed email event, newest first.</div>
      </div>
      <button class="btn btn-sm" :disabled="loading" @click="load">Refresh</button>
    </div>

    <div class="card">
      <div v-if="error" class="empty-state">Couldn't load: {{ error }}</div>
      <div v-else-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!rows.length" class="empty-state">No activity yet.</div>
      <ActivityTable v-else :rows="rows" :show-actions="false" />
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
</style>
