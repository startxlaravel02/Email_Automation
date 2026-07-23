<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '—' },
  tone: { type: String, default: 'default' }, // default | success | warn | danger | info
})
</script>

<template>
  <div class="card stat">
    <div class="stat-icon" :class="`t-${tone}`">
      <slot name="icon" />
    </div>
    <div class="stat-body">
      <div class="stat-value">{{ value }}</div>
      <div class="stat-label muted">{{ label }}</div>
    </div>
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.stat-icon {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--primary-50);
  color: var(--primary); /* the icon inherits this via stroke=currentColor */
}
.stat-icon.t-success { background: var(--success-bg); color: var(--success); }
.stat-icon.t-warn { background: var(--warn-bg); color: var(--warn); }
.stat-icon.t-danger { background: var(--danger-bg); color: var(--danger); }
.stat-icon.t-info { background: var(--info-bg); color: var(--info); }
.stat-value {
  font-family: var(--font-mono); /* monospace numbers, like the reference */
  font-variant-numeric: tabular-nums;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.2;
}
.stat-label {
  font-size: var(--fs-xs);
  margin-top: 1px;
}
</style>
