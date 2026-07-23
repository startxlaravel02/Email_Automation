<script setup>
import { onMounted, onUnmounted, reactive, ref, computed } from 'vue'
import { api } from '@/services/api'
import BarList from '@/components/BarList.vue'

const loading = ref(true)
const error = ref('')
const from = ref('')
const to = ref('')
const updatedAt = ref('')

const data = reactive({
  overview: {},
  breakdowns: { device: [], browser: [], client: [], country: [] },
  mostClicked: [],
  recent: [],
  trend: [],
  heatmap: [],
})

function rangeQuery() {
  const p = new URLSearchParams()
  if (from.value) p.set('from', from.value)
  if (to.value) p.set('to', to.value)
  return p.toString()
}
const exportHref = (format) => {
  const qs = rangeQuery()
  return `/api/analytics/export?format=${format}` + (qs ? '&' + qs : '')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const qs = rangeQuery()
    const r = await api.get('/analytics/dashboard' + (qs ? '?' + qs : ''))
    data.overview = r.overview || {}
    data.breakdowns = r.breakdowns || { device: [], browser: [], client: [], country: [] }
    data.mostClicked = r.mostClicked || []
    data.recent = r.recent || []
    data.trend = r.trend || []
    data.heatmap = r.heatmap || []
    updatedAt.value = new Date().toLocaleTimeString()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function clearRange() {
  from.value = ''
  to.value = ''
  load()
}

// --- KPIs ---
const kpis = computed(() => {
  const o = data.overview || {}
  const rt = o.rates || {}
  return [
    { label: 'Emails sent', val: o.totalSent ?? 0, cap: 'replies delivered', tone: '' },
    { label: 'Open rate', val: (rt.open ?? 0) + '%', cap: 'opened at least once', tone: 'good' },
    { label: 'Click rate', val: (rt.click ?? 0) + '%', cap: 'clicked a link inside', tone: 'good' },
    { label: 'Bounce rate', val: (rt.bounce ?? 0) + '%', cap: 'undeliverable — lower is better', tone: 'bad' },
    { label: 'Unsub rate', val: (rt.unsubscribe ?? 0) + '%', cap: 'opted out — lower is better', tone: 'warn' },
  ]
})

// --- Most clicked (bar width) ---
const maxClicks = computed(() => Math.max(1, ...data.mostClicked.map((l) => l.clicks || 0)))

// --- Heatmap grid ---
const DAYS = [['Mon', 2], ['Tue', 3], ['Wed', 4], ['Thu', 5], ['Fri', 6], ['Sat', 7], ['Sun', 1]]
const heat = computed(() => {
  const map = {}
  let max = 0
  for (const d of data.heatmap || []) {
    map[d.dow + '-' + d.hour] = d.count
    if (d.count > max) max = d.count
  }
  const rows = DAYS.map(([label, dow]) => ({
    label,
    cells: Array.from({ length: 24 }, (_, h) => {
      const c = map[dow + '-' + h] || 0
      return { hour: h, count: c, op: c ? (0.18 + 0.82 * (c / max)).toFixed(2) : 0 }
    }),
  }))
  return { max, rows }
})

// --- Trend chart (opens vs clicks) as an inline SVG string ---
const chartSvg = computed(() => {
  const trend = data.trend || []
  if (!trend.length) return ''
  const byDay = {}
  trend.forEach((t) => {
    const d = String(t.day || '').slice(0, 10)
    byDay[d] = byDay[d] || { o: 0, c: 0 }
    if (t.eventType === 'open') byDay[d].o = t.count
    else if (t.eventType === 'click') byDay[d].c = t.count
  })
  const days = Object.keys(byDay).sort()
  const t = days.map((d) => ({ d: d.slice(5), o: byDay[d].o, c: byDay[d].c }))
  const W = 560, H = 190, P = { t: 14, r: 12, b: 26, l: 26 }
  const iw = W - P.l - P.r, ih = H - P.t - P.b, n = t.length
  const max = Math.max(...t.map((d) => Math.max(d.o, d.c)), 1)
  const x = (i) => P.l + (n === 1 ? iw / 2 : i * (iw / (n - 1)))
  const y = (v) => P.t + ih - (v / max) * ih
  const line = (k) => t.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const area = (k) =>
    `${line(k)} L${x(n - 1).toFixed(1)},${(P.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(P.t + ih).toFixed(1)} Z`
  const grid = [0, 0.5, 1]
    .map((f) => `<line x1="${P.l}" y1="${(P.t + ih - f * ih).toFixed(1)}" x2="${W - P.r}" y2="${(P.t + ih - f * ih).toFixed(1)}" stroke="var(--border)"/>`)
    .join('')
  const ticks = t
    .map((d, i) => (i % 3 === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="var(--muted)" text-anchor="middle">${d.d}</text>` : ''))
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Opens and clicks over time">
    <defs>
      <linearGradient id="gO" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".26"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient>
      <linearGradient id="gC" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--success)" stop-opacity=".22"/><stop offset="1" stop-color="var(--success)" stop-opacity="0"/></linearGradient>
    </defs>
    ${grid}
    <path d="${area('o')}" fill="url(#gO)"/><path d="${line('o')}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${area('c')}" fill="url(#gC)"/><path d="${line('c')}" fill="none" stroke="var(--success)" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(t[n - 1].o).toFixed(1)}" r="3.6" fill="var(--primary)"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(t[n - 1].c).toFixed(1)}" r="3.6" fill="var(--success)"/>
    ${ticks}
  </svg>`
})

// --- Recent table helpers ---
const EVENT_CLS = {
  open: 'badge-info',
  click: 'badge-success',
  unsubscribe: 'badge-warn',
  bounce: 'badge-danger',
  spam_complaint: 'badge-danger',
}
const eventCls = (t) => EVENT_CLS[t] || 'badge-muted'
function fmt(t) {
  const d = new Date(t)
  return isNaN(d) ? t : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function detailOf(r) {
  return r.event_type === 'click' && r.link_url ? r.link_url : r.subject || ''
}
function deviceOf(r) {
  return [r.device_type, r.browser].filter(Boolean).join(' · ') || '—'
}

let timer = null
onMounted(() => {
  load()
  timer = setInterval(load, 15000)
})
onUnmounted(() => timer && clearInterval(timer))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">Email Tracking</div>
        <div class="page-subtitle">
          How your sent replies perform.
          <span v-if="updatedAt" class="muted">· updated {{ updatedAt }}</span>
        </div>
      </div>
      <div class="export-bar">
        <span class="muted">Export:</span>
        <a class="btn btn-sm" :href="exportHref('csv')">CSV</a>
        <a class="btn btn-sm" :href="exportHref('xlsx')">Excel</a>
        <a class="btn btn-sm" :href="exportHref('pdf')">PDF</a>
      </div>
    </div>

    <!-- Date range -->
    <div class="filter-bar">
      <span class="muted">Date range</span>
      <input v-model="from" type="date" class="input date" />
      <span class="muted">→</span>
      <input v-model="to" type="date" class="input date" />
      <button class="btn btn-sm btn-primary" @click="load">Apply</button>
      <button class="btn btn-sm" @click="clearRange">Clear</button>
    </div>

    <div v-if="error" class="card card-pad err">Couldn't load tracking: {{ error }}</div>

    <!-- KPIs -->
    <div class="kpis">
      <div v-for="k in kpis" :key="k.label" class="card kpi" :class="k.tone">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-val mono">{{ k.val }}</div>
        <div class="kpi-cap muted">{{ k.cap }}</div>
      </div>
    </div>
    <p class="subnote muted">
      <b class="mono">{{ data.overview.totalOpens || 0 }}</b> opens across
      <b class="mono">{{ data.overview.openedEmails || 0 }}</b> emails ·
      <b class="mono">{{ data.overview.totalClicks || 0 }}</b> clicks across
      <b class="mono">{{ data.overview.clickedEmails || 0 }}</b> emails ·
      <b class="mono">{{ data.overview.bounced || 0 }}</b> bounced ·
      <b class="mono">{{ data.overview.unsubscribed || 0 }}</b> unsubscribed
    </p>

    <!-- Trend + audience -->
    <div class="grid-2">
      <div class="card card-pad">
        <div class="panel-head">
          <div>
            <div class="section-label">Engagement over time</div>
            <div class="hint muted">Opens vs. clicks</div>
          </div>
          <div class="legend">
            <span><i style="background: var(--primary)"></i>Opens</span>
            <span><i style="background: var(--success)"></i>Clicks</span>
          </div>
        </div>
        <div v-if="chartSvg" class="chart" v-html="chartSvg"></div>
        <div v-else class="empty-state">No engagement yet</div>
      </div>

      <div class="card card-pad">
        <div class="section-label">Audience</div>
        <div class="seg"><h4>Device</h4><BarList :items="data.breakdowns.device" /></div>
        <div class="seg"><h4>Browser</h4><BarList :items="data.breakdowns.browser" /></div>
        <div class="seg"><h4>Email client</h4><BarList :items="data.breakdowns.client" /></div>
      </div>
    </div>

    <!-- Links + locations -->
    <div class="grid-2">
      <div class="card card-pad">
        <div class="section-label">Most clicked links</div>
        <div v-if="!data.mostClicked.length" class="empty-state">No clicks yet</div>
        <div v-else class="links">
          <div v-for="(l, i) in data.mostClicked" :key="l.url" class="link-row">
            <div class="rank mono">{{ i + 1 }}</div>
            <div class="link-main">
              <div class="link-url">{{ l.url }}</div>
              <div class="track">
                <div class="fill" :style="{ width: ((l.clicks / maxClicks) * 100).toFixed(0) + '%' }"></div>
              </div>
            </div>
            <div class="link-stat">
              <b class="mono">{{ l.clicks }}</b>
              <span class="muted">{{ l.uniq }} unique</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <div class="section-label">Top locations</div>
        <div class="seg-top"><BarList :items="data.breakdowns.country" /></div>
      </div>
    </div>

    <!-- Heatmap -->
    <div class="card card-pad">
      <div class="section-label">Click activity by time</div>
      <div class="hint muted">Day of week × hour of day (darker = more clicks)</div>
      <div v-if="!heat.max" class="empty-state">No clicks yet</div>
      <div v-else class="hm-scroll">
        <div class="hm">
          <div></div>
          <div v-for="h in 24" :key="'h' + h" class="hm-h">{{ (h - 1) % 6 === 0 ? h - 1 : '' }}</div>
          <template v-for="row in heat.rows" :key="row.label">
            <div class="hm-day">{{ row.label }}</div>
            <div
              v-for="cell in row.cells"
              :key="row.label + cell.hour"
              class="hm-c"
              :style="cell.count ? { background: 'var(--primary)', opacity: cell.op } : {}"
              :title="`${row.label} ${cell.hour}:00 — ${cell.count} click(s)`"
            ></div>
          </template>
        </div>
      </div>
    </div>

    <!-- Recent activity -->
    <div class="card">
      <div class="card-pad thead-row"><div class="section-label">Recent activity</div></div>
      <div v-if="loading && !data.recent.length" class="empty-state">Loading…</div>
      <div v-else-if="!data.recent.length" class="empty-state">No activity yet</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Recipient</th>
              <th>Detail</th>
              <th>Device</th>
              <th>Location</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in data.recent" :key="i">
              <td><span class="badge" :class="eventCls(r.event_type)">{{ r.event_type }}</span></td>
              <td class="nowrap">{{ r.recipient_email }}</td>
              <td class="detail">{{ detailOf(r) }}</td>
              <td class="muted nowrap">{{ deviceOf(r) }}</td>
              <td class="muted nowrap">{{ r.country || '—' }}</td>
              <td class="muted nowrap mono">{{ fmt(r.created_at) }}</td>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.export-bar,
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

/* KPIs */
.kpis {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}
.kpi {
  padding: 14px 16px;
  position: relative;
  overflow: hidden;
}
.kpi::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary);
}
.kpi.good::before { background: var(--success); }
.kpi.warn::before { background: var(--warn); }
.kpi.bad::before { background: var(--danger); }
.kpi-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.kpi-val {
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 5px 0 2px;
}
.kpi-cap {
  font-size: var(--fs-xs);
}
.subnote {
  font-size: var(--fs-sm);
  margin: -2px 2px 2px;
}
.subnote .mono {
  font-family: var(--font-mono);
  color: var(--text);
}

/* layout grids */
.grid-2 {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 16px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.hint {
  font-size: var(--fs-xs);
  margin-top: 2px;
}
.legend {
  display: flex;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  display: inline-block;
}
.seg {
  margin-top: 14px;
}
.seg h4 {
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
.seg-top {
  margin-top: 12px;
}

/* links */
.links {
  margin-top: 6px;
}
.link-row {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.link-row:last-child {
  border-bottom: none;
}
.rank {
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--muted);
  text-align: center;
}
.link-url {
  font-size: var(--fs-sm);
  word-break: break-all;
}
.link-main .track {
  margin-top: 6px;
  max-width: 340px;
  height: 8px;
  background: var(--surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.link-main .fill {
  height: 100%;
  background: var(--success);
  border-radius: 6px;
}
.link-stat {
  text-align: right;
  white-space: nowrap;
}
.link-stat b {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  font-weight: 700;
}
.link-stat span {
  display: block;
  font-size: var(--fs-xs);
}

/* heatmap */
.hm-scroll {
  overflow-x: auto;
  margin-top: 12px;
}
.hm {
  display: grid;
  grid-template-columns: 34px repeat(24, minmax(14px, 1fr));
  gap: 3px;
  align-items: center;
  min-width: 520px;
}
.hm-h {
  font-size: 9px;
  color: var(--muted);
  text-align: center;
}
.hm-day {
  font-size: var(--fs-xs);
  color: var(--text-2);
  text-align: right;
  padding-right: 4px;
}
.hm-c {
  height: 15px;
  border-radius: 3px;
  background: var(--surface-2);
}

/* recent table */
.table-wrap {
  overflow-x: auto;
}
.nowrap {
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
}
.detail {
  max-width: 280px;
  white-space: normal;
  word-break: break-word;
  color: var(--text-2);
}
.thead-row {
  border-bottom: 1px solid var(--border);
}
.err {
  color: var(--danger);
  background: var(--danger-bg);
  border-color: var(--danger-bg);
  font-size: var(--fs-sm);
}
.chart {
  margin-top: 4px;
}

@media (max-width: 900px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .kpis {
    grid-template-columns: 1fr;
  }
}
</style>
