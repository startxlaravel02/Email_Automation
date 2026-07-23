<script setup>
defineProps({ status: { type: String, default: '' } })

const MAP = {
  replied: { cls: 'badge-success', label: 'Replied' },
  skipped: { cls: 'badge-muted', label: 'Skipped' },
  escalated: { cls: 'badge-warn', label: 'Escalated' },
  bounced: { cls: 'badge-danger', label: 'Bounced' },
}
const meta = (s) => MAP[s] || { cls: 'badge-info', label: s || '—' }
</script>

<template>
  <span class="badge" :class="meta(status).cls">{{ meta(status).label }}</span>
</template>
