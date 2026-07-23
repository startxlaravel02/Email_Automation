<script setup>
import { X } from 'lucide-vue-next'
import StatusBadge from './StatusBadge.vue'

defineProps({
  open: { type: Boolean, default: false },
  email: { type: Object, default: null },
})
defineEmits(['close'])

function when(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  return isNaN(d) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div v-if="open && email" class="overlay" @click.self="$emit('close')">
    <div class="modal card">
      <div class="modal-head">
        <div class="modal-title">Email details</div>
        <button class="icon-btn" @click="$emit('close')"><X :size="18" :stroke-width="2" /></button>
      </div>

      <div class="modal-body">
        <div class="row">
          <span class="k">Status</span>
          <span class="v"><StatusBadge :status="email.status" /></span>
        </div>
        <div class="row">
          <span class="k">From</span>
          <span class="v">{{ email.sender }}</span>
        </div>
        <div class="row">
          <span class="k">Subject</span>
          <span class="v">{{ email.subject || '(no subject)' }}</span>
        </div>
        <div class="row">
          <span class="k">Mode</span>
          <span class="v">{{ email.delivery_mode || '—' }}</span>
        </div>
        <div class="row">
          <span class="k">AI time</span>
          <span class="v mono">{{ email.ai_ms ? (email.ai_ms / 1000).toFixed(1) + ' s' : '—' }}</span>
        </div>
        <div class="row">
          <span class="k">When</span>
          <span class="v">{{ when(email.processed_at) }}</span>
        </div>
        <div v-if="email.reason" class="row">
          <span class="k">Reason</span>
          <span class="v">{{ email.reason }}</span>
        </div>

        <div class="reply-block">
          <div class="k">Reply</div>
          <div v-if="email.reply_preview" class="reply-text">{{ email.reply_preview }}</div>
          <div v-else class="muted">No reply generated.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(16, 24, 40, 0.45);
  display: grid;
  place-items: center;
  padding: 20px;
}
.modal {
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-weight: 700;
}
.modal-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  gap: 12px;
  font-size: var(--fs-sm);
}
.k {
  width: 74px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding-top: 1px;
}
.v {
  color: var(--text-2);
  word-break: break-word;
}
.mono {
  font-family: var(--font-mono);
}
.reply-block {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.reply-text {
  margin-top: 6px;
  font-size: var(--fs-sm);
  color: var(--text-2);
  white-space: pre-wrap;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
}
.icon-btn:hover {
  background: var(--surface-2);
}
</style>
