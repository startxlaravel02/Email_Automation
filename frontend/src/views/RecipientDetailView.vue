<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Eye } from 'lucide-vue-next'
import { api } from '@/services/api'
import { levelMeta, stageLabel, LEVELS, LEVEL_SUMMARY_LABEL } from '@/utils/engagement'

const route = useRoute()
const router = useRouter()

const email = computed(() => route.params.email)
const loading = ref(true)
const error = ref('')
const data = ref({ emails: [], timeline: [], suppressed: null })

function fmt(t) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d) ? t : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtDay(t) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d) ? t : d.toLocaleDateString([], { dateStyle: 'medium' })
}

const EVENT_CLS = {
  open: 'badge-info',
  click: 'badge-success',
  unsubscribe: 'badge-warn',
  bounce: 'badge-danger',
  spam_complaint: 'badge-danger',
}
const eventCls = (t) => EVENT_CLS[t] || 'badge-muted'

// Count this recipient's emails by engagement level (for the summary chips).
const levelCounts = computed(() => {
  const c = { verified: 0, high: 0, medium: 0, low: 0, none: 0 }
  for (const e of data.value.emails || []) {
    const k = e.engagement_level || 'none'
    c[k] = (c[k] || 0) + 1
  }
  return c
})

const stats = computed(() => {
  const emails = data.value.emails || []
  return {
    emails: emails.length,
    opens: emails.reduce((s, e) => s + (e.open_count || 0), 0),
    clicks: emails.reduce((s, e) => s + (e.click_count || 0), 0),
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await api.get('/analytics/recipient?email=' + encodeURIComponent(email.value))
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function openThread(e) {
  if (e.thread_id) router.push({ name: 'conversation', params: { threadId: e.thread_id } })
}

onMounted(load)
watch(() => route.params.email, load) // reload when navigating to a different recipient
</script>

<template>
  <div class="page">
    <div class="page-head">
      <button class="btn btn-sm" @click="router.push({ name: 'recipients' })">
        <ArrowLeft :size="15" :stroke-width="2" /> Recipients
      </button>
      <button class="btn btn-sm" :disabled="loading" @click="load">Refresh</button>
    </div>

    <!-- header -->
    <div class="card card-pad head-card">
      <div class="head-main">
        <div class="email">{{ email }}</div>
        <span v-if="data.suppressed" class="badge badge-warn">suppressed · {{ data.suppressed }}</span>
      </div>
      <div class="stats">
        <span><b class="mono">{{ stats.emails }}</b> emails</span>
        <span><b class="mono">{{ stats.opens }}</b> opens</span>
        <span><b class="mono">{{ stats.clicks }}</b> clicks</span>
      </div>
    </div>

    <div v-if="error" class="card card-pad err">Failed: {{ error }}</div>

    <!-- engagement summary + links clicked -->
    <div class="grid-2">
      <div class="card card-pad">
        <div class="section-label">Engagement summary</div>
        <div class="chips">
          <div v-for="lvl in LEVELS" :key="lvl" class="chip">
            <span class="badge" :class="levelMeta(lvl).cls">{{ LEVEL_SUMMARY_LABEL[lvl] }}</span>
            <b class="mono">{{ levelCounts[lvl] }}</b>
          </div>
        </div>
      </div>
      <div class="card card-pad">
        <div class="section-label">Links clicked</div>
        <div v-if="!data.links || !data.links.length" class="empty small">No link clicks yet.</div>
        <div v-else class="links">
          <div v-for="l in data.links" :key="l.url" class="link-row">
            <span class="link-url">{{ l.url }}</span>
            <span class="link-clicks"><b class="mono">{{ l.clicks }}</b> click{{ l.clicks == 1 ? '' : 's' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- emails -->
    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Emails sent to this recipient</div></div>
      <div v-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!data.emails.length" class="empty-state">No emails.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="sno-col">#</th>
              <th>Subject</th>
              <th>Delivery</th>
              <th>Engagement</th>
              <th>Clicks</th>
              <th>Sent</th>
              <th class="actions-col">Thread</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(e, i) in data.emails"
              :key="e.id"
              :class="{ 'click-row': e.thread_id }"
              @click="openThread(e)"
            >
              <td class="sno mono muted">{{ i + 1 }}</td>
              <td class="wrap strong">{{ e.subject || '(no subject)' }}</td>
              <td class="nowrap">{{ e.delivery_status }}</td>
              <td class="nowrap">
                <span class="badge" :class="levelMeta(e.engagement_level).cls">{{ levelMeta(e.engagement_level).label }}</span>
                <div class="sub muted">{{ stageLabel(e.engagement_stage) }}</div>
              </td>
              <td class="nowrap">
                <span class="mono">{{ e.click_count }}</span>
                <div v-if="e.click_count" class="sub muted">last {{ fmtDay(e.last_clicked_at) }}</div>
              </td>
              <td class="muted nowrap">{{ fmt(e.sent_at) }}</td>
              <td class="actions-col">
                <button
                  v-if="e.thread_id"
                  class="icon-btn"
                  title="View conversation"
                  @click.stop="openThread(e)"
                >
                  <Eye :size="16" :stroke-width="2" />
                </button>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- timeline -->
    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Timeline — every open, click & event</div></div>
      <div v-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!data.timeline.length" class="empty-state">No events yet.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Event</th><th>Detail</th><th>Device</th><th>Location</th><th>When</th></tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in data.timeline" :key="i">
              <td><span class="badge" :class="eventCls(t.event_type)">{{ t.event_type }}</span></td>
              <td class="wrap">{{ t.event_type === 'click' && t.link_url ? t.link_url : t.subject || '' }}</td>
              <td class="muted nowrap">{{ [t.device_type, t.browser].filter(Boolean).join(' · ') || '—' }}</td>
              <td class="muted nowrap">{{ t.country || '—' }}</td>
              <td class="muted nowrap mono">{{ fmt(t.created_at) }}</td>
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
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.head-card {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.head-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.email {
  font-size: var(--fs-lg);
  font-weight: 700;
  word-break: break-all;
}
.stats {
  display: flex;
  gap: 18px;
  margin-left: auto;
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.stats b {
  font-family: var(--font-mono);
  color: var(--text);
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
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
}
.chip .mono {
  font-family: var(--font-mono);
  font-weight: 700;
}
.links {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
}
.link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.link-row:last-child {
  border-bottom: none;
}
.link-url {
  word-break: break-all;
  color: var(--text-2);
}
.link-clicks {
  white-space: nowrap;
  color: var(--text-2);
}
.link-clicks .mono {
  font-family: var(--font-mono);
  color: var(--text);
}
.empty.small {
  padding: 12px 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
@media (max-width: 760px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
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
.sub {
  font-size: var(--fs-xs);
  margin-top: 3px;
}
.wrap {
  white-space: normal;
  word-break: break-word;
  max-width: 300px;
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
.err {
  color: var(--danger);
  background: var(--danger-bg);
  border-color: var(--danger-bg);
  font-size: var(--fs-sm);
}
</style>
