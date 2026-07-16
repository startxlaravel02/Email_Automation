# Email Tracking & Analytics — Build Notes & Handoff

> Companion to `PROJECT_CONTEXT.md`. Covers all work from **2026-07-09 → 2026-07-16**.
> Status: tracking engine + geo/device enrichment + bot/proxy classification +
> analytics dashboard + exports **built, live, and verified end-to-end** on localhost
> (production-only signals verified via a Cloudflare quick tunnel).

---

## 1. What this adds

Every reply the assistant **sends** (not drafts) is now tracked. We record:

- **Opens** — via a 1×1 invisible pixel.
- **Clicks** — every link is rewritten through a redirect endpoint.
- **Unsubscribes** — CAN-SPAM footer link → opt-out + auto-suppress.
- **Bounces** — best-effort scan of mailer-daemon notices → auto-suppress.
- **Per-event enrichment** — device, browser, email client, country, **city**.
- **Human vs machine classification** — each event flagged `human` / `proxy` / `bot`.

A dashboard visualizes it all; data exports to CSV / Excel / PDF; a date filter
scopes both the view and the export.

**Tracking is opt-in per send and gated by `TRACKING_ENABLED` (default on).**
Drafts are never tracked (nothing is sent). If `TRACKING_ENABLED=false`, `sendTracked`
falls back to a plain send.

---

## 2. How a tracked email flows

**Send** (`poller.service.js` → `deliver()` → `sendTracked()` when `AUTO_SEND=true`):
1. Guard: skip if recipient is on the suppression list.
2. Generate a random `token` (16 bytes hex) and a `Message-ID` `<token@host>`.
3. `buildTrackedHtml(body, token)` (`utils/htmlEmail.js`):
   - Pull every `http(s)` URL out, rewrite each to `/track/click/{token}/{linkId}` (`l1`, `l2`, …).
   - Append an **unsubscribe + physical-address footer** (CAN-SPAM).
   - Inject the open pixel `/track/open/{token}.gif` (last, `display:none`).
   - Returns `{ html, text, links }`.
4. Persist: `createTrackedEmail(...)` + `addTrackedLinks(trackedId, links)`.
5. Build a **multipart/alternative** MIME (text + HTML) and send via `sendRawMessage`.
6. `markSent` / `markFailed`.

**Open** — `GET /track/open/:token.gif` → `recordOpen` → **always returns the pixel**
(a broken image must never show in the email).

**Click** — `GET /track/click/:token/:linkId` → `recordClick` → **302 to the stored URL**
(redirects only to a URL we saved — no open-redirect via request input).

**Unsubscribe** — `GET /track/unsubscribe/:token` → `recordUnsubscribe` → confirmation
page + adds the recipient to `suppressed_recipients`.

---

## 3. Files (added / changed)

```
backend/
├── data/dbip-city-lite.mmdb          # DB-IP City Lite geo DB (~125MB, GITIGNORED)
├── migrations/
│   ├── 001_create_email_tracking.sql # 4 tracking tables
│   └── 002_add_event_source.sql      # + email_events.source flag + index
├── test-geo.js                       # verify the city DB resolves IPs
└── src/
    ├── utils/
    │   ├── htmlEmail.js               # plain text -> tracked HTML (pixel + links + footer)
    │   ├── enrichClient.js            # UA -> device/browser/client; IP -> country/city
    │   ├── botFilter.js               # classifyEvent() -> human | proxy | bot
    │   └── mimeBuilder.js             # + buildRawMultipartReply() (text + HTML)
    ├── services/
    │   ├── trackingService.js         # sendTracked(): the tracked-send orchestrator
    │   ├── bounceService.js           # scanBounces() + self-scheduling loop
    │   └── gmailService.js            # + sendRawMessage / searchMessages / getRawMessage
    ├── models/
    │   ├── tracking.model.js          # writes: record{Open,Click,Unsub,Bounce}, suppression
    │   └── trackingStats.model.js     # reads: all dashboard aggregates (date+source scoped)
    ├── controllers/
    │   ├── track.controller.js        # public open/click/unsub endpoints
    │   ├── analytics.controller.js    # dashboard + recipient search/detail
    │   └── export.controller.js       # CSV / XLSX / PDF
    └── routes/
        ├── track.routes.js            # /track/*
        └── analytics.routes.js        # /api/analytics/*
backend/public/
├── tracking.html                      # analytics dashboard (KPIs, chart, breakdowns, heatmap, exports, date filter)
└── recipients.html                    # per-recipient search + timeline drill-down
```

`app.js` mounts `/track` and `/api/analytics`, sets `app.set("trust proxy", 1)`
(so `req.ip` reads the real client IP from `X-Forwarded-For`), and serves `public/`.

---

## 4. Database schema

DB `ai_email_assistant`, all InnoDB / utf8mb4.

- **`tracked_emails`** — one row per sent+tracked reply. `reply_id` (FK→replies, SET NULL),
  `recipient_email`, `tracking_token` (UNIQUE), `message_id`, `subject`, `sent_at`,
  `delivery_status` ENUM(`sent`,`delivered`,`bounced`,`failed`), `open_count`,
  `first/last_opened_at`, `click_count`, `first/last_clicked_at`, `bounced_at`,
  `spam_complaint_at`, `unsubscribed_at`, timestamps. `campaign_id` nullable (deferred).
- **`tracked_links`** — `tracked_email_id` (FK CASCADE), `link_id` (`l1`…), `url`.
  The click redirect target comes from here (never from request input).
- **`email_events`** — one row per interaction. `tracked_email_id` (FK CASCADE),
  `event_type` ENUM(`open`,`click`,`bounce`,`spam_complaint`,`unsubscribe`),
  **`source` ENUM(`human`,`proxy`,`bot`)** ← added in migration 002,
  `link_id`, `link_url`, `ip_address`, `user_agent`, `device_type`, `browser`,
  `email_client`, `country`, `city`, `created_at`. Index on `(event_type, source, created_at)`.
- **`suppressed_recipients`** — `email` (PK), `reason` ENUM(`unsubscribed`,`bounced`,`spam_complaint`).
  The poller checks this before ever replying (auto-suppress).

---

## 5. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/track/open/:token.gif` | Log open, return 1×1 pixel |
| GET | `/track/click/:token/:linkId` | Log click, 302 to stored URL |
| GET | `/track/unsubscribe/:token` | Opt-out + suppress, confirmation page |
| GET | `/api/analytics/dashboard?from&to` | All dashboard data in one call |
| GET | `/api/analytics/recipients?q=` | Recipient search (rollups) |
| GET | `/api/analytics/recipient?email=` | One recipient: emails + timeline |
| GET | `/api/analytics/export?format=csv\|xlsx\|pdf&from&to` | Download report |

Dashboards: `/tracking.html` (analytics), `/recipients.html` (drill-down).

---

## 6. Geo / device enrichment (`enrichClient.js`)

- **Device / browser / email client** ← from the request User-Agent (`ua-parser-js`).
  `email_client` detects `GoogleImageProxy → Gmail`, Outlook, Apple Mail, Yahoo, Thunderbird.
- **Country / city** ← from the IP, offline, no external API:
  - Primary: **DB-IP City Lite** `.mmdb` (via the `maxmind` package), loaded once at
    startup. Path: `backend/data/dbip-city-lite.mmdb` (override with `GEOIP_CITY_DB`).
  - Fallback: `geoip-lite` (country-good, city-poor) if the `.mmdb` / package is missing —
    the app never crashes over geo. Startup logs `[geo] city database loaded: …` or a warning.
- **Verified** (`node test-geo.js`): `8.8.8.8 → US/Mountain View`, `1.1.1.1 → AU/Sydney`,
  IPv6 `2407:aa80:… → PK/Karachi`.
- **Production note:** the `.mmdb` is gitignored, so it must be downloaded onto the
  server at deploy time (DB-IP publishes a fresh file monthly; CC-BY → add attribution).

---

## 7. Bot / proxy classification — the `source` flag (`botFilter.js`)

This is the most important concept in the system. `classifyEvent({eventType, ip, userAgent, secondsSinceSent})`
returns one of:

| `source` | Meaning | Counted as? |
|---|---|---|
| `human` | A real device made the request | ✅ everything |
| `proxy` | Fetched via an email image proxy (Gmail's `GoogleImageProxy` / Google IP) | ✅ as an **open** (open counter); ❌ excluded from device/geo breakdowns (it's Google's data, not the recipient's) |
| `bot` | Automated: pixel loaded **<10s after send** (prefetch/cache), OR a click from a **datacenter IP / scanner UA** (SafeLinks, Googlebot, …) | ❌ excluded everywhere; kept raw for audit |

Rules:
- **Open** → `bot` if within `TRACKING_PREFETCH_SECONDS` (default 10) of send; else
  `proxy` if proxy-UA/Google IP; else `human`.
- **Click / unsubscribe** → `bot` if datacenter IP / proxy-UA / scanner-UA; else `human`.

**We keep every event** (raw + flagged). The stats queries filter:
`getBreakdown`/`getMostClickedLinks`/`getClickHeatmap` use `source='human'`;
`getRecentActivity`/`getEngagementTrend`/recipient timeline use `source <> 'bot'`.
Counters on `tracked_emails` are incremented conditionally: `open_count` for non-bot
opens (human+proxy), `click_count` for human clicks only — so `getOverview`
(which reads the counters) is bot-filtered automatically.

### ⚠️ The hard truth this encodes (critical for anyone reading dashboards)
- **A `proxy` open is NOT proof a human opened it.** For Gmail, a human open and a
  Gmail cache-fetch are byte-identical (same `GoogleImageProxy` UA, same Google IP).
  There is **no signal** anywhere that distinguishes them. Open tracking is therefore
  a **soft** signal for Gmail/Apple recipients — by design (Google/Apple hide it).
- **Only `human` events are 100% confirmed people.** Clicks and (future) replies are
  the reliable engagement signals. Opens from **non-proxied clients** (Outlook desktop,
  Thunderbird) *are* confirmed human (`source=human`); Gmail/Apple opens are not.
- **Opens show Google, not the recipient:** `66.249.x` IP, `Mountain View`,
  `email_client=Gmail` — that's Google's proxy. Real recipient location/device comes
  from **clicks**.
- **Mobile / IPv6 geo is carrier-level:** a Karachi user on mobile data can resolve to
  Islamabad (carrier gateway). Country is reliable; mobile city is approximate. No DB fixes this.
- `GSA` in a UA = **Google Search App** (link opened inside Google's app). Legit.

---

## 8. Bounces & suppression

- `bounceService.scanBounces()` searches Gmail for `(from:mailer-daemon OR from:postmaster)
  newer_than:3d -label:"Bounce-Processed"`, extracts the failed recipient
  (`X-Failed-Recipients` / `Final-Recipient`), calls `recordBounce` (marks the latest
  sent email bounced + suppresses the address), and labels the notice processed.
- Self-scheduling loop gated by `BOUNCE_SCAN_ENABLED` / `BOUNCE_SCAN_INTERVAL_MS`.
- **Spam complaints are NOT trackable via Gmail** — they'd require Google Postmaster
  Tools (aggregate only, own-domain sending), not the Gmail API. Column exists but stays null.

---

## 9. Config (.env) additions

```
PUBLIC_BASE_URL=http://localhost:5000   # base for pixel/link URLs (the tunnel/domain in prod)
COMPANY_ADDRESS=...                      # CAN-SPAM footer physical address
TRACKING_ENABLED=true                    # false = plain send, no tracking
BOUNCE_SCAN_ENABLED=true
BOUNCE_SCAN_INTERVAL_MS=60000
# optional:
GEOIP_CITY_DB=...                        # override path to the .mmdb
TRACKING_PREFETCH_SECONDS=10             # opens faster than this after send = bot/prefetch
```

---

## 10. How to test production-only signals locally

Opens/city/email-client don't populate on `localhost` (Gmail's proxy can't reach it).
To get real opens/geo without deploying, use a **Cloudflare quick tunnel** (no account/API key):
```
cloudflared tunnel --url http://localhost:5000    # prints https://<random>.trycloudflare.com
```
Set `PUBLIC_BASE_URL` to that URL, restart Node, send a fresh email, open it in real
Gmail + click a link. **Gotchas:** the URL changes on every tunnel restart (re-sync
`.env` + restart Node + send a *fresh* email — old emails point to the dead URL);
phpMyAdmin doesn't auto-refresh (use the dashboard, which polls every 15s).

---

## 11. Pending decisions (discussed, NOT yet built)

1. **Leaner storage** — move `email_client` onto `tracked_emails` (captured once), then
   store **only `human` events** (proxy/bot opens leave no row, just bump the counter).
   Removes unbounded proxy-open growth while keeping every useful human row. Trade-off:
   loses the raw "what got filtered" audit. *(User leaning toward this.)*
2. **`click`-implies-open** — a human click with no recorded open also counts an open
   (fixes the "clicked but images blocked → 0 opens" undercount). 100% human.
3. **`reply`-implies-open** — when a reply arrives on a thread, mark that tracked email
   opened/engaged. Rescues "opened but never clicks" recipients; fits this reply-driven app.
   Needs thread→tracked_email linkage plumbing.
4. **Event Log dashboard view** — show raw per-event detail (IP/city/client/device/source)
   in the UI instead of phpMyAdmin.

---

## 12. Before go-live / at scale (hardening backlog)

- **🔴 No auth on `/api/analytics`, `/api/dashboard`, `/track`, the HTML pages** — data
  is exposed to anyone with the URL. Must gate before public deploy.
- **DB indexes** for `email_events` growth (migration 002 added one; add more as needed).
- **HTTPS** via reverse proxy (nginx/Caddy); structured logging + monitoring.
- **Scale ceiling** is the LLM (Ollama ~30s/reply on CPU, serial in the poll loop) →
  GPU + a job queue + Gmail push (watch/Pub/Sub) instead of polling.

---

## 13. Paused work

- **USPTO trademark lead-gen pipeline** — planned in detail, then paused to build
  tracking first. Only `saxes` + `fast-xml-parser` are installed; **no code written yet.**
```
