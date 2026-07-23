<script setup>
import { computed } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  color: { type: String, default: 'var(--primary)' },
})

const max = computed(() => Math.max(1, ...props.items.map((i) => i.count || 0)))
const pct = (n) => (((n || 0) / max.value) * 100).toFixed(0)
</script>

<template>
  <div v-if="!items.length" class="empty-state">No data yet</div>
  <div v-else class="bars">
    <div v-for="it in items" :key="it.label" class="brow">
      <span class="lab" :title="it.label">{{ it.label || '—' }}</span>
      <div class="track">
        <div class="fill" :style="{ width: pct(it.count) + '%', background: color }"></div>
      </div>
      <span class="val mono">{{ it.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.brow {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--fs-sm);
}
.lab {
  width: 108px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}
.track {
  flex: 1;
  height: 8px;
  background: var(--surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.4s ease;
}
.val {
  width: 46px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text);
}
</style>
