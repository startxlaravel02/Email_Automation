<script setup>
import { onMounted, ref, reactive, computed } from 'vue'
import { X } from 'lucide-vue-next'
import { api } from '@/services/api'

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(25)
const from = ref('')
const to = ref('')
const loading = ref(true)
const error = ref('')

const PAGE_SIZES = [25, 50, 75, 100]

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

const DEADLINE = { section_8: '§8', section_8_9: '§8/§9', section_71: '§71', unknown: '—' }

// --- CSV export field picker ---
const showExport = ref(false)
const EXPORT_FIELDS = [
  { key: 'serial_number', label: 'Serial number', def: true },
  { key: 'registration_number', label: 'Registration number', def: true },
  { key: 'owner_email', label: 'Email', def: true },
  { key: 'owner_name', label: 'Owner name', def: true },
  { key: 'owner_address', label: 'Address', def: true },
  { key: 'mark_text', label: 'Trademark (mark)', def: true },
  { key: 'computed_deadline_date', label: 'Deadline date', def: false },
  { key: 'deadline_type', label: 'Deadline type', def: false },
  { key: 'registration_date', label: 'Registration date', def: false },
  { key: 'registration_expiration_date', label: 'Registration expiration', def: false },
  { key: 'filing_date', label: 'Filing date', def: false },
  { key: 'renewal_date', label: 'Renewal date', def: false },
  { key: 'abandonment_date', label: 'Abandonment date', def: false },
  { key: 'cancellation_date', label: 'Cancellation date', def: false },
  { key: 'status_code', label: 'Status code', def: false },
  { key: 'status_text', label: 'Status text', def: false },
  { key: 'is_dead', label: 'Is dead', def: false },
  { key: 'attorney_name', label: 'Attorney name', def: false },
  { key: 'attorney_confirmed_at', label: 'Attorney confirmed at', def: false },
  { key: 'lead_status', label: 'Lead status', def: false },
  { key: 'source', label: 'Source', def: false },
  { key: 'email_sent_at', label: 'Email sent at', def: false },
  { key: 'created_at', label: 'Created at', def: false },
  { key: 'updated_at', label: 'Updated at', def: false },
]
const fieldSel = reactive(Object.fromEntries(EXPORT_FIELDS.map((f) => [f.key, f.def])))
function setAll(v) {
  EXPORT_FIELDS.forEach((f) => (fieldSel[f.key] = v))
}
function downloadCsv() {
  const fields = EXPORT_FIELDS.filter((f) => fieldSel[f.key]).map((f) => f.key)
  if (!fields.length) {
    alert('Select at least one column.')
    return
  }
  const p = new URLSearchParams({ fields: fields.join(',') })
  if (from.value) p.set('from', from.value)
  if (to.value) p.set('to', to.value)
  const a = document.createElement('a')
  a.href = '/api/leads/export?' + p.toString()
  a.download = 'leads.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  showExport.value = false
}

function fmtDay(t) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d) ? t : d.toLocaleDateString([], { dateStyle: 'medium' })
}

async function load(withCount = true) {
  loading.value = true
  error.value = ''
  try {
    const p = new URLSearchParams({ page: page.value, pageSize: pageSize.value })
    if (from.value) p.set('from', from.value)
    if (to.value) p.set('to', to.value)
    if (!withCount) p.set('count', '0') // page nav reuses the existing total
    const r = await api.get('/leads?' + p.toString())
    rows.value = r.rows || []
    if (r.total != null) total.value = r.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  load(true)
}
function clearFilters() {
  from.value = ''
  to.value = ''
  page.value = 1
  load(true)
}
function onPageSize() {
  page.value = 1
  load(true)
}
function go(delta) {
  const next = page.value + delta
  if (next < 1 || next > pageCount.value) return
  page.value = next
  load(false) // rows only — total unchanged
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">Leads</div>
        <div class="page-subtitle">Verified trademark leads — <b class="mono">{{ total }}</b> total.</div>
      </div>
      <button class="btn btn-sm btn-primary" @click="showExport = true">Download CSV</button>
    </div>

    <!-- filters -->
    <div class="filter-bar">
      <span class="muted">Deadline</span>
      <input v-model="from" type="date" class="input date" />
      <span class="muted">→</span>
      <input v-model="to" type="date" class="input date" />
      <button class="btn btn-sm btn-primary" @click="applyFilters">Apply</button>
      <button class="btn btn-sm" @click="clearFilters">Clear</button>
    </div>

    <div class="card">
      <div class="card-pad thead-row">
        <div class="section-label">Leads</div>
        <div class="rows-per">
          <span class="muted">Rows</span>
          <select v-model.number="pageSize" class="select size-select" @change="onPageSize">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>

      <div v-if="error" class="empty-state">Failed: {{ error }}</div>
      <div v-else-if="loading" class="empty-state">Loading…</div>
      <div v-else-if="!rows.length" class="empty-state">No leads found.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="sno-col">#</th>
              <th>Owner</th>
              <th>Email</th>
              <th>Trademark</th>
              <th>Attorney</th>
              <th>Deadline</th>
              <th>Type</th>
              <th>Serial</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id">
              <td class="sno mono muted">{{ rangeStart + i }}</td>
              <td class="wrap strong">{{ r.owner_name || '—' }}</td>
              <td class="wrap email">{{ r.owner_email }}</td>
              <td class="wrap">{{ r.mark_text || '—' }}</td>
              <td class="nowrap">
                <span v-if="!r.attorney_name" class="badge badge-success">No attorney</span>
                <span v-else class="badge badge-muted" :title="r.attorney_name">Has attorney</span>
              </td>
              <td class="nowrap mono">{{ fmtDay(r.computed_deadline_date) }}</td>
              <td class="nowrap">{{ DEADLINE[r.deadline_type] || '—' }}</td>
              <td class="nowrap mono muted">{{ r.serial_number }}</td>
              <td class="nowrap"><span class="badge badge-info">{{ r.lead_status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- pagination -->
      <div v-if="!loading && rows.length" class="pager card-pad">
        <div class="muted">
          <b class="mono">{{ rangeStart }}–{{ rangeEnd }}</b> of <b class="mono">{{ total }}</b>
        </div>
        <div class="pager-btns">
          <button class="btn btn-sm" :disabled="page <= 1" @click="go(-1)">Prev</button>
          <span class="muted page-ind">Page <b class="mono">{{ page }}</b> / {{ pageCount }}</span>
          <button class="btn btn-sm" :disabled="page >= pageCount" @click="go(1)">Next</button>
        </div>
      </div>
    </div>

    <!-- CSV column picker -->
    <div v-if="showExport" class="overlay" @click.self="showExport = false">
      <div class="modal card">
        <div class="modal-head">
          <div class="modal-title">Download CSV — choose columns</div>
          <button class="icon-btn" @click="showExport = false"><X :size="18" :stroke-width="2" /></button>
        </div>
        <div class="modal-body">
          <div class="field-actions">
            <button class="btn btn-sm" @click="setAll(true)">Select all</button>
            <button class="btn btn-sm" @click="setAll(false)">Clear all</button>
          </div>
          <div class="fields">
            <label v-for="f in EXPORT_FIELDS" :key="f.key" class="field">
              <input v-model="fieldSel[f.key]" type="checkbox" />
              <span>{{ f.label }}</span>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-sm" @click="showExport = false">Cancel</button>
          <button class="btn btn-sm btn-primary" @click="downloadCsv">Download</button>
        </div>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page-subtitle .mono {
  font-family: var(--font-mono);
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
}
.input.date {
  width: auto;
  height: 32px;
}
.thead-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}
.rows-per {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
}
.size-select {
  width: auto;
  height: 30px;
  padding: 0 8px;
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
.strong {
  font-weight: 600;
  color: var(--text);
}
.email {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.wrap {
  white-space: normal;
  word-break: break-word;
  max-width: 200px;
}
.nowrap {
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.pager-btns {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-ind {
  font-size: var(--fs-sm);
}

/* export modal */
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
  display: flex;
  flex-direction: column;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-weight: 700;
}
.modal-body {
  padding: 14px 18px;
  overflow-y: auto;
}
.field-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.field input {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
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
@media (max-width: 520px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
