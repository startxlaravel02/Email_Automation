# USPTO Trademark Lead-Gen Pipeline — Architecture & Status

_Last updated: 2026-07-22_

## Goal

Find trademark owners whose registration has a **maintenance/renewal deadline coming up soon**
and who are **not represented by an attorney**, so we can email them and pitch a renewal-filing
service. Everything is free/open-source (bulk data + TSDR API key are free).

The relevant statutory deadlines (all measured from the registration date):
- **§8 Declaration of Use** — between years 5 and 6.
- **§8 + §9 renewal** — between years 9 and 10, then every 10 years.
- **§71** — Madrid/§66(a) international registrations, renewed on the 10-year cycle.

## Data source

USPTO **Trademark Annual XML (full register, 1884→present)**, product `TRTYRAP`, snapshot
`apc18840407-20251231`, delivered as **91 zip parts** (~150–290 MB each; the extracted XML is
2–3 GB each). This is the entire register, so it includes millions of dead/abandoned marks and
pending applications — we keep everything and filter at query time.

## Pipeline (stages, in order)

```
download 91 zips ──► for each part: extract (yauzl) ──► parse (SAX) ──► upsert into MySQL ──► delete XML+zip
(bulkDownloadOnly)    (bulkProcessDownloaded, child process per part)                          (disk stays flat)
                                        │
                                        ▼
                         trademark_leads  (~14M rows, one per serial)
                                        │
                         TSDR verify near-deadline marks (tsdrVerifyAndQualify + tsdrClient)
                                        │
                                        ▼
                         qualified_leads VIEW  (alive + no attorney + has email)
                                        │
                                        ▼
                         outreach (email pitch)  ← NOT BUILT YET
```

### Scripts (`backend/src/services/uspto/` and `backend/src/utils/uspto/`)

| File | Role |
|---|---|
| `bulkDownloadOnly.js` | Download the 91 zip parts (axios stream). |
| `bulkExtractOnly.js` | Standalone extract-only: stream each zip's XML to disk with **yauzl**, delete the zip. Exports `extractXml`. |
| `bulkSeedExtracted.js` | Seed already-extracted XMLs into MySQL, deleting each after a clean seed (used to drain the first ~26 parts). |
| `bulkProcessDownloaded.js` | **Main interleaved processor**: for each zip → extract (yauzl) → seed **in a child process** → delete XML → delete zip. Resumable via `data/uspto/processed-parts.json`. |
| `bulkAnnualSeed.js` | `seedFromFile(xml)` — SAX-parse a part and batch-upsert (500/batch). Also runnable as a CLI (this is what the child process runs). |
| `utils/uspto/bulkXmlParser.js` | Streaming SAX parser + `computeDeadline`. Emits **every** case-file. |
| `tsdrClient.js` | `fetchTsdrRecord(serial, apiKey)` — live TSDR API, extracts attorney / owner email / status (WIPO ST.96 schema). |
| `tsdrVerifyAndQualify.js` | Pulls near-deadline candidates, verifies each against TSDR (~1 req/sec), writes ground truth back, reports qualified count. |

## Why the tricky bits are the way they are (hard-won)

- **yauzl, not adm-zip:** the extracted XMLs are 2–3 GB. adm-zip loads the whole file into a
  ~2 GB-capped Node Buffer and throws "length out of range". yauzl streams to disk → size-agnostic.
- **Child process per part:** `seedFromFile` buffers a whole part's ~155k parsed records in memory.
  Running 60+ parts in one long-lived process accumulated heap until Node aborted (`JavaScript heap
  out of memory`, ~4 GB) mid-run. A fresh child per part (`--max-old-space-size=6144`) releases all
  memory on exit → flat memory, and one bad part can't kill the whole run.
- **Interleave + delete:** only one 2–3 GB XML exists on disk at a time (the drive is ~50 GB); the
  zip and XML are both deleted once a part seeds cleanly.
- **`computeDeadline` is a COARSE pre-filter:** the bulk file does **not** populate
  `registration-expiration-date`, its `renewal-date` is the *last* renewal (a past date, not the
  next due date), and the section-8/renewal *flags* are unreliable (frequently blank on live marks).
  So the deadline is derived purely from dates and always rolled forward to a **future** date
  (last renewal + 10 yr; or reg+6 if the first §8 isn't due yet, else next 10-yr from registration).
  It's good enough to decide **which serials to verify** — the exact deadline comes from TSDR.
- **`is_dead` is incomplete for old marks:** the bulk file often lacks a cancellation date for
  long-dead old marks, so `is_dead=0` can be wrong. TSDR is the authority on live/dead — which is
  why verification is needed before any outreach.

## Database

### `trademark_leads` (migration `005` + `006`)

One row per serial number (`UNIQUE(serial_number)` → `ON DUPLICATE KEY UPDATE` handles re-runs, no
dup rows). Key columns:

- Identity: `serial_number`, `registration_number`, `mark_text`, `owner_name`, `owner_address`
- Dates: `filing_date`, `registration_date`, `registration_expiration_date`, `abandonment_date`,
  `cancellation_date`, `renewal_date`, `computed_deadline_date`, `deadline_type`
- Flags/state: `is_dead`, `attorney_name`, `owner_email`, `status_text`, `attorney_confirmed_at`,
  `lead_status` (`new → verified → qualified → sent → bounced/opted_out`), `email_sent_at`
- Indexes: `idx_lead_queue (computed_deadline_date, attorney_name, email_sent_at)`,
  `idx_lead_alive_deadline (is_dead, computed_deadline_date)`

`owner_email` / `status_text` are **only** filled by TSDR (the bulk file has neither).

### `qualified_leads` VIEW

A live filter over the one table — **no second table, nothing to sync**:
```sql
lead_status='verified' AND (attorney_name IS NULL OR attorney_name='')
  AND owner_email IS NOT NULL AND owner_email<>''
  AND (status_text IS NULL OR status_text NOT REGEXP 'abandon|cancel')
```
When a lead is later emailed, its `lead_status` becomes `sent` and it drops out of the view →
the view always shows "qualified & not yet contacted."

> ⚠️ phpMyAdmin's browse-view row count for InnoDB is an **estimate** and lags badly. Always use
> `SELECT COUNT(*) FROM ...` for the true number.

## Current state (2026-07-22)

- ✅ **All 91 parts seeded** → `trademark_leads` ≈ **13,993,768 rows**. All zips/XMLs deleted; disk
  reclaimed. (Parts 07 & 09 were corrupt on first download; re-downloaded and seeded.)
- 🔄 **TSDR verification in progress** — window **20–45 days to deadline**, **all** alive marks in
  that window (~41,390), verifying every mark (attorney or not) so we also catch marks whose
  attorney was recently withdrawn. **Stopped at 5,832 verified / 1,020 qualified** (paused for the
  day; resumable). Random-sample yield ≈ **20% qualify** → est. **~8,000 sendable leads** total.
- ⏸ **Outreach step not built.**

### Window counts (bulk pre-verification, for reference)

| Window (deadline in) | Total alive | No attorney | Attorney |
|---|---|---|---|
| 20–45 days | 41,390 | 14,076 | 27,314 |
| 30–45 days | 23,815 | 8,585 | 15,230 |
| 0–45 days | 67,553 | 23,293 | 44,260 |

## How to run / resume

**Resume TSDR verification** (skips already-verified rows automatically):
```powershell
cd c:\Users\HP\Desktop\ai-email\backend
$env:TSDR_WINDOW_MIN_DAYS=20; $env:TSDR_WINDOW_DAYS=45; $env:TSDR_BATCH_LIMIT=50000
node src\services\uspto\tsdrVerifyAndQualify.js
```
~1 req/sec (TSDR's limit); ~35k left ≈ ~10 h. Runs in your terminal so you see per-row hits; Ctrl+C
to stop, re-run to continue. Requires `USPTO_API_KEY` in `.env`.

**Progress checks:**
```sql
SELECT COUNT(*) FROM trademark_leads WHERE attorney_confirmed_at IS NOT NULL;  -- verified
SELECT COUNT(*) FROM qualified_leads;                                          -- sendable leads
```

**Re-process any parts** (e.g. a fresh download): drop them in `E:\uspto-data\bulk-parts` and run
`node src\services\uspto\bulkProcessDownloaded.js` (skips parts already in `processed-parts.json`).

### Env vars

`USPTO_API_KEY` (TSDR), `USPTO_DOWNLOAD_DIR` (default `E:\uspto-data\bulk-parts`),
`USPTO_EXTRACT_DIR` (default `E:\uspto-data\extracted-data`), `TSDR_WINDOW_MIN_DAYS`,
`TSDR_WINDOW_DAYS`, `TSDR_BATCH_LIMIT`, `USPTO_CHILD_HEAP_MB` (default 6144).

## Next steps

1. **Finish TSDR verification** of the 20–45 day window (~35k remaining).
2. **Build the outreach step** — pull from `qualified_leads`, send the renewal pitch (tracked), set
   `lead_status='sent'`. (Reuse the existing tracking/email pipeline.)
3. Optionally widen the window or add a rolling daily-sync so new near-deadline marks keep flowing.
