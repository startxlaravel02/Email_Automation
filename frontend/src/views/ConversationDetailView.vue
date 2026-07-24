<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { api } from '@/services/api'
import { levelMeta, stageLabel } from '@/utils/engagement'
import StatusBadge from '@/components/StatusBadge.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const messagesLoading = ref(true)
const error = ref('')
const messages = ref([])
const log = ref([])
const tracking = ref([])
const links = ref([])

const subject = computed(() => log.value.find((l) => l.subject)?.subject || 'Conversation')

function fromName(sender = '') {
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*</)
  return (m ? m[1] : sender.replace(/<.*>/, '')).trim() || sender
}
function aiTime(ms) {
  return ms ? `${(ms / 1000).toFixed(1)} s` : '—'
}
function when(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  return isNaN(d) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

// Show only the NEW content of each message — drop the quoted history that email
// clients append (the "On <date> ... wrote:" block and any lines starting with ">").
function cleanReply(text = '') {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*>/.test(l)) { cut = i; break } // a quoted line
    if (/^\s*On\b.+\bwrote:/.test(l)) { cut = i; break } // "On ... wrote:" (one line)
    // "On ... <email>" with "wrote:" wrapped onto the next line
    if (/^\s*On\b.+<[^>]+@[^>]+>\s*$/.test(l) && /^\s*wrote:/.test(lines[i + 1] || '')) {
      cut = i
      break
    }
  }
  return lines.slice(0, cut).join('\n').trim() || text.trim()
}

// Fast: tracking + log + links (DB, ~50ms). Renders the page immediately.
async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get(`/dashboard/conversations/${encodeURIComponent(route.params.threadId)}`)
    log.value = r.log || []
    tracking.value = r.tracking || []
    links.value = r.links || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
  loadMessages()
}

// Slow: the live Gmail thread (~1.5s). Fetched separately so the chat fills in
// without blocking the rest of the page.
async function loadMessages() {
  messagesLoading.value = true
  messages.value = []
  try {
    const r = await api.get(`/dashboard/conversations/${encodeURIComponent(route.params.threadId)}/messages`)
    messages.value = r.messages || []
  } catch (e) {
    /* messages optional — leave empty on error */
  } finally {
    messagesLoading.value = false
  }
}

onMounted(load)
watch(() => route.params.threadId, load) // reload when navigating to a different thread
</script>

<template>
  <div class="page">
    <div class="page-head">
      <button class="btn btn-sm" @click="router.back()">
        <ArrowLeft :size="15" :stroke-width="2" /> Back
      </button>
      <button class="btn btn-sm" :disabled="loading" @click="load">Refresh</button>
    </div>

    <div>
      <div class="page-title">{{ subject }}</div>
      <div class="page-subtitle">Full conversation and processing history.</div>
    </div>

    <div v-if="error" class="card card-pad err">Couldn't load: {{ error }}</div>

    <!-- Conversation -->
    <div class="card card-pad">
      <div class="section-label">Conversation</div>
      <div v-if="messagesLoading" class="empty-state">Loading messages…</div>
      <div v-else-if="!messages.length" class="empty-state">
        No message content available for this thread.
      </div>
      <div v-else class="thread">
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="{ ours: m.isFromUs }">
          <div class="bubble">
            <div class="msg-head">
              <span class="who">{{ m.isFromUs ? 'Us' : fromName(m.from) }}</span>
              <span class="date muted">{{ m.date }}</span>
            </div>
            <div class="text">{{ cleanReply(m.text) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tracking status for sent emails on this thread -->
    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Tracking</div></div>
      <div v-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!tracking.length" class="empty-state">No tracked sends for this thread.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Sent email</th><th>Delivery</th><th>Engagement</th><th>Clicks</th><th>Sent</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in tracking" :key="t.id">
              <td class="tw-wrap">{{ t.subject || '(no subject)' }}</td>
              <td class="nowrap">{{ t.delivery_status }}</td>
              <td class="nowrap">
                <span class="badge" :class="levelMeta(t.engagement_level).cls">{{ levelMeta(t.engagement_level).label }}</span>
                <div class="sub muted">{{ stageLabel(t.engagement_stage) }}</div>
              </td>
              <td class="mono">{{ t.click_count }}</td>
              <td class="muted nowrap">{{ when(t.sent_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Links clicked on this thread -->
    <div v-if="links.length" class="card">
      <div class="card-pad thead-row"><div class="section-label">Links clicked</div></div>
      <div class="links">
        <div v-for="l in links" :key="l.url" class="link-row">
          <span class="link-url">{{ l.url }}</span>
          <span class="link-clicks"><b class="mono">{{ l.clicks }}</b> click{{ l.clicks == 1 ? '' : 's' }}</span>
        </div>
      </div>
    </div>

    <!-- Activity log for this thread -->
    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Activity log</div></div>
      <div v-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!log.length" class="empty-state">No log entries.</div>
      <div v-else class="log">
        <div v-for="l in log" :key="l.id" class="log-row">
          <StatusBadge :status="l.status" />
          <span class="log-when muted">{{ when(l.processed_at) }}</span>
          <span class="log-mode muted">{{ l.delivery_mode || '—' }}</span>
          <span class="log-ai muted mono">{{ aiTime(l.ai_ms) }}</span>
          <span v-if="l.reason" class="log-reason muted">· {{ l.reason }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.err {
  color: var(--danger);
  background: var(--danger-bg);
  border-color: var(--danger-bg);
  font-size: var(--fs-sm);
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}
.msg {
  display: flex;
  justify-content: flex-start;
}
.msg.ours {
  justify-content: flex-end;
}
.bubble {
  max-width: 78%;
  min-width: 250px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  background: var(--surface-2);
}
.msg.ours .bubble {
  background: var(--primary-50);
  border-color: var(--primary-50);
}
.msg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}
.who {
  font-weight: 600;
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.date {
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.text {
  font-size: var(--fs-sm);
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}
.thead-row {
  border-bottom: 1px solid var(--border);
}
.log {
  display: flex;
  flex-direction: column;
}
.log-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
  flex-wrap: wrap;
}
.log-row:last-child {
  border-bottom: none;
}
.mono {
  font-family: var(--font-mono);
}
.table-wrap {
  overflow-x: auto;
}
.nowrap {
  white-space: nowrap;
}
.tw-wrap {
  white-space: normal;
  word-break: break-word;
  max-width: 320px;
}
.sub {
  font-size: var(--fs-xs);
  margin-top: 3px;
}
.links {
  padding: 0 16px;
}
.link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
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
@media (max-width: 640px) {
  .bubble {
    max-width: 92%;
  }
  .page-head {
    flex-wrap: wrap;
  }
}
</style>
