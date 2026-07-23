<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Eye } from 'lucide-vue-next'
import { api } from '@/services/api'

const router = useRouter()
const q = ref('')
const list = ref([])
const loading = ref(true)
const error = ref('')

function fmt(t) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d) ? t : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

async function search() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/analytics/recipients?q=' + encodeURIComponent(q.value.trim()))
    list.value = r.recipients || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function openRecipient(email) {
  router.push({ name: 'recipient', params: { email } })
}

let timer = null
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(search, 250)
})

onMounted(search)
</script>

<template>
  <div class="page">
    <div>
      <div class="page-title">Recipient Activity</div>
      <div class="page-subtitle">Search a recipient, then open them to see every email, open and click.</div>
    </div>

    <div class="search">
      <Search :size="16" :stroke-width="2" class="search-icon" />
      <input v-model="q" class="input search-input" type="text" placeholder="Search by email…" />
    </div>

    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Recipients</div></div>
      <div v-if="error" class="empty-state">Failed: {{ error }}</div>
      <div v-else-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!list.length" class="empty-state">No recipients found.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="sno-col">#</th>
              <th>Recipient</th>
              <th>Emails</th>
              <th>Opens</th>
              <th>Clicks</th>
              <th>Last activity</th>
              <th>Status</th>
              <th class="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in list" :key="p.email" class="click-row" @click="openRecipient(p.email)">
              <td class="sno mono muted">{{ i + 1 }}</td>
              <td class="nowrap strong">{{ p.email }}</td>
              <td class="mono">{{ p.emails }}</td>
              <td class="mono">{{ p.opens }}</td>
              <td class="mono">{{ p.clicks }}</td>
              <td class="muted nowrap">{{ fmt(p.lastActivity) }}</td>
              <td>
                <span v-if="p.bounced" class="badge badge-danger">bounced</span>
                <span v-else class="badge badge-success">active</span>
              </td>
              <td class="actions-col">
                <button class="icon-btn" title="View recipient" @click.stop="openRecipient(p.email)">
                  <Eye :size="16" :stroke-width="2" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.search {
  position: relative;
  max-width: 420px;
}
.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
}
.search-input {
  height: 40px;
  padding-left: 34px;
}
.thead-row {
  border-bottom: 1px solid var(--border);
}
.table-wrap {
  overflow-x: auto;
}
.sno-col {
  width: 44px;
}
.sno {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.click-row {
  cursor: pointer;
}
.click-row:hover td {
  background: var(--surface-2);
}
.strong {
  font-weight: 600;
  color: var(--text);
}
.nowrap {
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
}
.actions-col {
  text-align: right;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
}
.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}
</style>
