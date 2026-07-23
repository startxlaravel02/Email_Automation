<script setup>
import { Eye, Pause, Play } from 'lucide-vue-next'
import StatusBadge from './StatusBadge.vue'

defineProps({ rows: { type: Array, default: () => [] } })
defineEmits(['toggle-pause', 'view'])

function fromName(sender = '') {
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*</)
  return (m ? m[1] : sender.replace(/<.*>/, '')).trim() || sender
}
function fromEmail(sender = '') {
  const m = sender.match(/<([^>]+)>/)
  return m ? m[1] : ''
}
function aiTime(ms) {
  return ms ? `${(ms / 1000).toFixed(1)} s` : '—'
}
function mode(row) {
  if (!row.delivery_mode) return '—'
  const base = row.delivery_mode.charAt(0).toUpperCase() + row.delivery_mode.slice(1)
  return row.used_context ? `${base} · ctx` : base
}
function when(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  return isNaN(d) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>Status</th>
          <th>From</th>
          <th>Subject / Reply</th>
          <th>Mode</th>
          <th>AI Time</th>
          <th>When</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td><StatusBadge :status="row.status" /></td>

          <td>
            <div class="from-name">{{ fromName(row.sender) }}</div>
            <div class="from-email muted">{{ fromEmail(row.sender) }}</div>
          </td>

          <td class="subject-cell">
            <div class="subject">{{ row.subject || '(no subject)' }}</div>
            <div v-if="row.reply_preview" class="reply muted">{{ row.reply_preview }}</div>
          </td>

          <td class="nowrap">{{ mode(row) }}</td>
          <td class="nowrap mono">{{ aiTime(row.ai_ms) }}</td>
          <td class="nowrap muted">{{ when(row.processed_at) }}</td>

          <td class="actions-col">
            <div class="actions">
              <button
                class="btn btn-sm"
                :class="row.paused ? 'is-paused' : ''"
                @click="$emit('toggle-pause', row)"
              >
                <component :is="row.paused ? Play : Pause" :size="14" :stroke-width="2" />
                {{ row.paused ? 'Resume' : 'Pause AI' }}
              </button>
              <button class="icon-btn" title="View details" @click="$emit('view', row)">
                <Eye :size="16" :stroke-width="2" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}
.from-name {
  font-weight: 600;
  color: var(--text);
}
.from-email {
  font-size: var(--fs-xs);
}
.subject-cell {
  max-width: 380px;
}
.subject {
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reply {
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
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
.actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.btn.is-paused {
  color: var(--success);
  border-color: var(--success);
  background: var(--success-bg);
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
