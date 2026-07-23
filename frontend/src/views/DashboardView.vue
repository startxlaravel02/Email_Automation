<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Mail, MailCheck, SkipForward, TriangleAlert } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useSettingsStore } from '@/stores/settings'
import StatCard from '@/components/StatCard.vue'

const settings = useSettingsStore()
const loading = ref(true)
const error = ref('')
const stats = reactive({ total: 0, replied: 0, skipped: 0, escalated: 0 })

function toggleAi() {
  settings.setAi(!settings.aiEnabled).catch((e) => alert('Failed: ' + e.message))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/dashboard/stats')
    stats.total = r.total || 0
    stats.replied = r.byStatus?.replied || 0
    stats.skipped = r.byStatus?.skipped || 0
    stats.escalated = r.byStatus?.escalated || 0
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  settings.fetchSettings().catch(() => {})
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Email automation activity overview.</div>
      </div>
      <div class="head-actions">
        <button
          class="ai-toggle"
          :class="{ on: settings.aiEnabled }"
          :disabled="settings.loading"
          @click="toggleAi"
        >
          <span class="ai-dot"></span>
          AI Auto-Reply: {{ settings.aiEnabled ? 'ON' : 'OFF' }}
        </button>
        <button class="btn btn-sm" :disabled="loading" @click="load">Refresh</button>
      </div>
    </div>

    <div v-if="error" class="card card-pad err">Couldn't reach the API: {{ error }}</div>

    <div class="stats-grid">
      <StatCard label="Total" :value="stats.total" tone="info">
        <template #icon><Mail :size="20" :stroke-width="2" /></template>
      </StatCard>
      <StatCard label="Replied" :value="stats.replied" tone="success">
        <template #icon><MailCheck :size="20" :stroke-width="2" /></template>
      </StatCard>
      <StatCard label="Skipped" :value="stats.skipped" tone="warn">
        <template #icon><SkipForward :size="20" :stroke-width="2" /></template>
      </StatCard>
      <StatCard label="Escalated" :value="stats.escalated" tone="danger">
        <template #icon><TriangleAlert :size="20" :stroke-width="2" /></template>
      </StatCard>
    </div>

    <div class="card">
      <div class="card-pad table-head-row">
        <div class="section-label">Recent activity</div>
      </div>
      <div class="empty-state">Activity table comes next — this is the shell.</div>
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
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-2);
}
.ai-toggle .ai-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
}
.ai-toggle.on {
  border-color: var(--success);
  color: var(--success);
  background: var(--success-bg);
}
.ai-toggle.on .ai-dot {
  background: var(--success);
}
.ai-toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.table-head-row {
  border-bottom: 1px solid var(--border);
}
.err {
  color: var(--danger);
  background: var(--danger-bg);
  border-color: var(--danger-bg);
  font-size: var(--fs-sm);
}
@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .page-head {
    flex-direction: column;
    align-items: stretch;
  }
  .head-actions {
    justify-content: flex-end;
  }
}
</style>
