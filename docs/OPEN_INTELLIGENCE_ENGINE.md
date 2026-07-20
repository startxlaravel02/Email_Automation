# Open Intelligence Engine — Architecture & Design

> A derived **engagement-intelligence layer** on top of the existing tracking system.
> It does **not** modify raw tracking. Raw events stay immutable; this layer *interprets*
> them into an explainable, versioned **engagement level** — never a false "opened = true".
>
> Status: **IMPLEMENTED & VERIFIED** (2026-07-17). Built in phases, each verified against the
> live DB: (1) migrations + derived tables + seed ruleset + models; (2) Trust Level model + all
> 8 signal extractors + engine (monotonic ratchet, evidence, overrides) + unit tests;
> (3) DB-backed queue + worker + fire-and-forget enqueue in tracking + backfill;
> (4) engagement APIs behind API-key auth; (5) campaign analyzer + temporal re-evaluator;
> plus a reply-verification hook (reply → VERIFIED even with no open/click). Author: architecture review, 2026-07-17.
>
> **Decisions locked (2026-07-17):** Phase-1 runtime = **DB-backed `engagement_jobs`
> queue + in-process worker** (debounced, restart-safe, no new infra). Scope = **full
> rules-based engine** — all six signal extractors + proxy-type weighting + versioned
> ruleset + explainability. **No ML in the first build** (labels are collected for later).
>
> **v2 refinements approved (2026-07-17):** Trust Levels replace numeric proxy weights;
> new `behaviorConsistency` signal; decoupled **Campaign Intelligence**; evidence-based
> dashboard with **no percentages**; per-email **engagement timeline**. Full detail and the
> exact change-list are in **§16** — where v2 conflicts with v1 numbers, **§16 wins**.

---

## 0. Principles (non-negotiable)

1. **Raw events are immutable and are the source of truth.** `email_events` is an
   append-only log. This engine only ever *reads* it and writes to *new, derived* tables.
2. **A proxy open is never promoted to a human open.** `source` on a raw event is fixed
   forever. Only the *derived* engagement level changes.
3. **Engagement is a confidence spectrum, not a boolean.** We output a **stage** + a
   **level** + a **score** + the **evidence**, never `opened=true`.
4. **Only intentional actions reach VERIFIED.** Click / reply / unsubscribe. Everything
   else is, at best, "likely."
5. **Every verdict is explainable and versioned.** We store *which signals fired, their
   weights, and the rule-set version*. A score you can't explain is a score you can't trust
   or tune — and it's the training label set for ML later.
6. **The intelligence layer is decoupled from the hot path.** The pixel/click endpoints
   stay as fast as they are today; scoring happens asynchronously.
7. **Users never see raw numbers.** Engagement is expressed as named **stages**, ordinal
   **Trust Levels**, and an **evidence list** — never a percentage. Any numeric score is an
   internal implementation detail. *(v2 — see §16.1 / §16.4.)*

---

## 1. Design critique — where we strengthen the brief (and why)

Your brief is directionally right (engagement as a spectrum, proxy ≠ human). But several
parts, taken literally, would produce a system that *inflates confidence* — the exact
failure you're trying to avoid. Here's what we change and why:

| # | In the brief | Problem | Our improvement |
|---|---|---|---|
| **1** | "Proxy detection" treated as one thing | **Not all proxies mean the same thing.** Gmail's proxy fetches roughly when the message is displayed (weakly correlated with viewing). **Apple MPP pre-fetches for *every* delivered mail whether or not it's opened** — it's almost pure noise. Treating them equally inflates Apple opens massively. | **Weight each open by proxy *type* trust.** Direct client ≈ 1.0, Gmail ≈ 0.5, Microsoft/Yahoo ≈ 0.4, **Apple MPP ≈ 0.05**. An MPP-only email can't climb past LOW. |
| **2** | Example: "proxy open several days later → HIGH" | **Time alone must not escalate confidence.** Repeated Gmail fetches over days can be re-caching or the *sender* viewing the thread — not the recipient. Escalating on elapsed time inflates machine noise into "HIGH". | **Escalation requires a *new, independent, human-plausible* signal** (a fresh open at a human time-of-day, irregular spacing, consistent fingerprint) — with **diminishing, capped** contribution. Passage of time by itself changes nothing. |
| **3** | Level implied to move freely | A level that flip-flops (HIGH yesterday, LOW today) is untrustworthy and breaks downstream logic. | **Stage is a monotonic ratchet** (only moves up; VERIFIED is terminal). The live **score** may fluctuate and is shown as the current read, but the *achieved stage* never silently downgrades. |
| **4** | "Calculate an engagement level" | A bare label with no reasoning is unusable, un-tunable, and untrustworthy — and contradicts "no arbitrary rules." | **Persist the full signal breakdown + rule-set version** on every computation. Explainability is a first-class output, not a nice-to-have. |
| **5** | Engine analyses signals (implied inline) | Running scoring inside the pixel request adds DB reads to the highest-volume, most latency-sensitive endpoint. | **Decouple:** endpoint writes the raw event (unchanged) → enqueues an eval job → a worker scores asynchronously, **debounced** per email so a burst of proxy fetches = one recompute. |
| **6** | (unstated) how state is maintained | Incrementally mutating a score as events arrive is fragile with duplicates/out-of-order proxy fetches (millions of events). | **Recompute from the full event set** for a tracked email (idempotent, with an event high-water mark). Incremental is only an optimization. |
| **7** | "Recipient historical behaviour raises future confidence" | Circular risk: if soft opens feed the prior and the prior raises soft opens, confidence inflates in a loop. Plus a cold-start problem. | **Build the recipient prior from HARD actions only** (actual clicks/replies), neutral on cold start, and let it **nudge within bounds** — never fabricate a level. |
| **8** | (unstated) signal → score coupling | If extraction and scoring are tangled, adding a signal or swapping in ML means rewriting the core. | **Separate signal *extraction* (pure) from *scoring* (aggregation).** This is the seam where ML plugs in later without touching extractors. |

---

## 2. Overall architecture

Event-driven, layered, and **decoupled from the ingestion hot path**:

```
        ┌─────────────────────── EXISTING (unchanged) ───────────────────────┐
Recipient → /track/open|click/unsub  →  recordOpen/Click/Unsub  →  email_events (immutable)
        └───────────────────────────────────────────────┬─────────────────────┘
                                                         │ (one added line: enqueue)
                                                         ▼
                                            ┌──────────────────────────┐
                                            │   Engagement Job Queue    │  debounced per tracked_email
                                            │  (DB table → Redis later) │
                                            └────────────┬─────────────┘
                                                         ▼
                        ┌──────────────────── OPEN INTELLIGENCE ENGINE ────────────────────┐
                        │  Worker: evaluate(trackedEmailId)                                 │
                        │   1. Load context (all events + recipient profile + active ruleset)│
                        │   2. Signal Extractors (pure)  ── proxyTrust, timing, pattern,     │
                        │                                   clientDirectness, ipReputation,  │
                        │                                   recipientHistory                 │
                        │   3. Override layer (human action → VERIFIED; MPP cap; bot exclude)│
                        │   4. Scoring aggregator (weighted, ruleset-driven) → score        │
                        │   5. Map → stage + level; apply monotonic ratchet                 │
                        └───────────┬───────────────────────────────────────┬───────────────┘
                                    ▼                                       ▼
                         email_engagement (derived,               recipient_engagement_profile
                         per tracked_email, overwriteable)        (per recipient, hard-action prior)
                                    │
                                    ▼
                   Engagement APIs  →  Dashboard (funnel + explainability)

        ┌──────────── Temporal Re-evaluator (scheduled) ────────────┐
        │ periodically re-enqueues non-terminal emails whose        │
        │ time-based signals may have matured (delivered N ago)     │
        └────────────────────────────────────────────────────────────┘
```

**Read/write model (CQRS-flavored):** raw events = write model (immutable facts);
`email_engagement` + `recipient_engagement_profile` = derived read models, always
reconstructable from events + ruleset. Losing a read model is never data loss — recompute it.

---

## 3. Database changes (raw tracking untouched)

`email_events`, `tracked_emails`, `tracked_links`, `suppressed_recipients` — **no changes.**

**New derived / config tables:**

**`email_engagement`** — one row per tracked email (the derived verdict; upsert-able).
- `tracked_email_id` PK/FK → tracked_emails
- `engagement_stage` ENUM(`delivered`,`open_signal`,`likely_engaged`,`verified_human`)
- `engagement_level` ENUM(`none`,`low`,`medium`,`high`,`verified`)
- `confidence_score` DECIMAL(4,3)  — live 0.000–1.000 (soft zone)
- `signals` JSON — explainability: each signal, its value, weight, contribution, evidence
- `ruleset_version` INT — which config produced this verdict
- `first_signal_at`, `verified_at`, `last_evaluated_at`
- `last_event_id` BIGINT — high-water mark (idempotency: skip if already evaluated ≥ this)
- `created_at`, `updated_at`
- Indexes: `(engagement_stage, last_evaluated_at)`, `(engagement_level)`

**`recipient_engagement_profile`** — one row per recipient (the prior; hard-action derived).
- `recipient_email` PK
- `emails_sent`, `verified_count`, `click_count`, `reply_count`, `unsubscribed` BOOL
- `avg_seconds_to_action` — behavioural timing
- `historical_engagement_score` DECIMAL(4,3) — bounded prior, from **hard actions only**
- `last_verified_at`, `updated_at`

**`engagement_rulesets`** — versioned, declarative scoring config (the "rule engine").
- `version` PK (INT), `is_active` BOOL, `config` JSON (weights, proxy-trust map, timing
  windows, band thresholds, caps, override rules), `notes`, `created_at`, `activated_at`
- Exactly one active row; a change = a new version (full audit + instant rollback).

**`engagement_jobs`** — DB-backed queue for the MVP (drop for Redis/BullMQ at scale).
- `id`, `tracked_email_id`, `status` ENUM(`queued`,`running`,`done`,`failed`),
  `run_after` (debounce), `attempts`, `enqueued_at`. Unique/dedup on `(tracked_email_id, status=queued)`.

**`engagement_audit`** *(optional, sampled at scale)* — append-only transitions:
`tracked_email_id`, `from_stage`, `to_stage`, `score`, `ruleset_version`, `trigger_event_id`, `at`.

---

## 4. The signal model

Each **signal extractor** is a pure function: `(context) → { name, value∈[0,1], evidence }`.
Context = all raw events for the tracked email + the recipient profile + `tracked_emails` row.
No signal writes anything; extraction is side-effect free and unit-testable.

| Signal | What it reads | Produces high value when… | Notes / guardrails |
|---|---|---|---|
| **proxyTrust** | open events' `email_client` / proxy UA / IP | opens come from a **direct (non-proxied) client** | Direct≈1.0, Gmail≈0.5, MS/Yahoo≈0.4, **Apple MPP≈0.05**. This is a *multiplier* on open-derived score, not an additive signal. |
| **timing** | first open vs `sent_at` | first open lands in a **human-plausible window** (minutes–hours) | `<prefetch window` already flagged `bot` → excluded. Instant = machine. |
| **openPattern** | full open timeline | opens spread across **distinct human time-of-day windows with irregular spacing** | Regular intervals / identical fingerprints → **discounted**. Diminishing returns; capped. |
| **clientDirectness** | whether any open is `source=human` | a real device fetched the pixel directly (Outlook desktop, Thunderbird) | Strong evidence of a real human view → can reach HIGH; still **not** VERIFIED (not intentional). |
| **ipReputation** | event IPs | residential/mobile IP consistent with recipient region/history | Datacenter/scanner already `bot`. Supports, doesn't dominate. |
| **recipientHistory** | `recipient_engagement_profile` | recipient historically clicks/replies | **Bounded nudge only**, hard-action-derived, neutral on cold start. Never creates a level alone. |

**Human-action signals are NOT scored** — they are hard overrides (see §5).

---

## 5. Engagement algorithm (explainable, non-arbitrary)

Two outputs from one computation:
- **stage** — coarse lifecycle funnel (monotonic ratchet): `delivered → open_signal → likely_engaged → verified_human`
- **level** — the confidence headline you asked for: `none / low / medium / high / verified`

They're two views of the same result:

| stage | level | reached when |
|---|---|---|
| delivered | none | sent, no open signal yet |
| open_signal | low | a proxy/open signal exists but evidence is weak |
| likely_engaged | medium / high | soft evidence accumulates (score bands) |
| verified_human | verified | an intentional action occurred |

**Step order (short-circuits top-down):**

1. **Override — human action.** If any `click`/`reply`/`unsubscribe` event exists →
   `stage=verified_human`, `level=verified`, `score=1.0`. Stop. *(Click = human, per brief.)*
2. **Override — caps.** Apple-MPP-only evidence → cap at `low`. All-`bot` events → stay
   `delivered`/`open_signal`, no climb.
3. **Score the soft zone** (opens without a human action):

   ```
   raw   = Σ ( signal.value × ruleset.weight[signal] )      // openPattern, timing, ipReputation, clientDirectness
   score = clamp( raw × proxyTrust × recipientHistoryNudge , 0 , ruleset.softCeiling )
   ```
   - `proxyTrust` ∈ (0,1] scales *everything* by how trustworthy the fetch source is (the MPP fix).
   - `recipientHistoryNudge` ∈ [0.9, 1.15] — bounded prior; can't invent a level.
   - `softCeiling` < the VERIFIED threshold **always** — soft evidence can never *become* verified.
   - All weights/thresholds/caps come from the **active ruleset**, not hardcoded.
4. **Band → level.** `score < t_low → low`; `t_low..t_high → medium`; `≥ t_high → high`.
   (`t_low`, `t_high` are ruleset config, tunable + versioned — this is the anti-"3 opens = human" mechanism.)
5. **Ratchet.** `new_stage = max(stored_stage, computed_stage)`. Stage never drops; the live
   `score`/`level` is stored as the current read for transparency.
6. **Persist** verdict + `signals` breakdown + `ruleset_version` + `last_event_id`.

**Anti-inflation guardrails (explicit):**
1. VERIFIED is reachable **only** by a real action.
2. Apple MPP alone ≤ LOW.
3. Near-instant / machine-regular opens are discounted or excluded (`bot`).
4. **Elapsed time alone never escalates** — a *new independent* human-plausible open must arrive.
5. Stage is monotonic; no silent downgrades.
6. Recipient prior is bounded and hard-action-only (no feedback loop).
7. Soft score is capped strictly below VERIFIED.

---

## 6. Rule engine architecture

Deliberately **not** a heavyweight rules DSL (Drools-style) — that's over-engineering for
this. Instead: a **versioned, declarative config** (`engagement_rulesets.config` JSON) with
two parts, evaluated by the scoring engine:

- **Override rules** (ordered, first-match): e.g. `has_action → verified`,
  `only_apple_mpp → cap:low`, `all_bot → no_climb`.
- **Scoring config**: `weights{}`, `proxyTrust{}`, `timingWindows{}`, `bandThresholds{}`,
  `caps{}`, `nudgeBounds{}`.

Properties that make it production-grade:
- **Versioned + one active** → change weights without a deploy; every verdict stamps the
  version → full reproducibility and **instant rollback**.
- **A/B / shadow mode** → run a candidate ruleset in "shadow" (compute + log, don't persist
  as canonical) to compare against the active one before activating.
- **Loaded + cached** in the worker; hot-reload on version bump.

---

## 7. Backend services (responsibilities, no code)

New domain module `src/engagement/`:
- **`signals/`** — one pure extractor per signal (§4). Trivially unit-testable.
- **`engagementEngine.js`** — orchestrates extractors → overrides → scoring → stage/level +
  explanation. Deterministic; no I/O.
- **`engagementService.js`** — application service: `evaluate(trackedEmailId)` loads context
  via models, runs the engine, **upserts** `email_engagement` (idempotent via `last_event_id`),
  triggers profile update on a VERIFIED transition.
- **`recipientProfileService.js`** — maintains `recipient_engagement_profile` from hard actions.
- **`engagementQueue.js` + worker** — consumes `engagement_jobs`, debounced per email.
- **`temporalReevaluator.js`** — scheduled sweep; re-enqueues non-terminal emails whose
  time-based signals may have matured. Bounded batch size; logs what it skips.
- **`rulesetLoader.js`** — loads/caches the active ruleset; seeds a default (v1) from a file.
- **`engagement.model.js`** — thin query layer for the new tables (matches existing model style).

**Only touch-point to existing code:** `recordOpen/recordClick/recordUnsubscribe` (and bounce)
get **one added fire-and-forget line** — enqueue an evaluation for that `tracked_email_id`.
Never blocks the response; if the queue write fails it's logged and swallowed (tracking must
never break).

---

## 8. Event processing flow

1. **Ingest (hot path, unchanged):** endpoint writes the raw event + updates counters.
2. **Enqueue (added):** fire-and-forget `enqueueEvaluation(trackedEmailId)` with a short
   debounce window (collapses proxy bursts into one recompute).
3. **Worker:** dequeue → load context (events + profile + active ruleset) → engine computes →
   idempotency check (`last_event_id`) → upsert `email_engagement`.
4. **On VERIFIED transition:** update `recipient_engagement_profile`; emit an internal
   `engagement.verified` domain event (future: CRM sync / webhooks / notifications).
5. **Temporal sweep:** on a schedule, re-enqueue non-terminal emails old enough that a
   time-based signal could have matured. This is what lets "delivered days ago, still only a
   proxy open" be re-judged — *without* time alone escalating it (§5 guardrail 4).

Idempotent and replayable: re-running evaluation on the same events yields the same verdict.

---

## 9. New APIs

All under `/api/engagement` (auth-gated — see §12 risk note):
- `GET /api/engagement/:trackedEmailId` — stage, level, score, `verified_at`.
- `GET /api/engagement/:trackedEmailId/explain` — the signal breakdown (why this level).
- `GET /api/engagement/recipient/:email` — profile + per-email engagement list.
- `GET /api/analytics/engagement/overview?from&to` — the **funnel**: delivered → open_signal
  → likely_engaged → verified, with conversion %.
- `POST /api/engagement/:trackedEmailId/recompute` *(admin)* — force re-eval (debug/tuning).
- `GET/POST /api/engagement/rulesets` *(admin)* — view/activate ruleset versions; shadow-run.

---

## 10. Dashboard changes

- **Engagement funnel** replaces the misleading flat "opens" number: Delivered →
  Open Signal → Likely Engaged → Verified Human, with drop-off %.
- **Per-email badge** = the level, with a hover **explanation** ("MEDIUM — 2 Gmail-proxy
  opens at plausible times; not a confirmed human"). Never "opened = true."
- **Honest labels** (a product-trust decision matching your philosophy): "Open Signal
  (network event — not a confirmed human view)" vs "Verified Human (clicked/replied)."
- **Per-recipient** engagement profile + "most engaged" leaderboard (by verified/likely).
- **Explainability panel** per email (the `signals` JSON, human-readable).
- Ruleset version indicator; admin tuning later.

---

## 11. Scaling plan (phased — don't build the end-state on day one)

- **Phase 1 (now, your scale):** DB-backed `engagement_jobs` queue + an in-process worker
  loop (like your existing pollers) + the temporal sweep. Handles today's volume easily.
- **Phase 2 (growth):** move the queue to **Redis/BullMQ**; run the worker as a **separate
  process**; add caching for rulesets and recipient profiles.
- **Phase 3 (millions/day):** event **stream** (Kafka/Kinesis) between ingestion and scoring;
  partition by recipient; a **feature store** for signals; pre-aggregated funnel rollups so the
  dashboard never scans raw events. Engine stays the same — only the transport changes.

This is exactly how Mailchimp/SendGrid-class systems separate **ingestion** (cheap, massive,
write-optimized) from **intelligence** (async, recomputable, read-optimized).

---

## 12. Future AI / ML improvements

The extractor→scorer seam is intentionally **ML-ready**:
- **Supervised model** replacing the linear aggregator: features = the same extracted signals;
  **labels = eventual hard outcomes** (did this email later get a click/reply?). The engine
  already logs signals + verdicts, so we're *collecting the training set from day one*.
- Start **rules-based** (explainable, cold-start-safe), graduate to a learned model (logistic
  regression → gradient-boosted trees) only when labeled volume justifies it. Keep version
  stamping so model versions are as auditable as rulesets.
- **Per-segment priors**, **anomaly detection** to auto-learn new proxy/scanner fingerprints,
  and feeding engagement back into **send-time / content optimization** for the AI replies.
- **Guardrail:** ML changes the *scoring*, never the *overrides* — a human action is always
  VERIFIED regardless of the model. And ML must remain explainable (feature attributions).

---

## 13. Folder structure

```
backend/src/
├── engagement/                      # NEW self-contained domain
│   ├── signals/
│   │   ├── proxyTrust.js
│   │   ├── timing.js
│   │   ├── openPattern.js
│   │   ├── clientDirectness.js
│   │   ├── ipReputation.js
│   │   └── recipientHistory.js
│   ├── engagementEngine.js          # pure orchestration: signals → score → stage/level
│   ├── engagementService.js         # application service (I/O + persistence)
│   ├── recipientProfileService.js
│   ├── engagementQueue.js           # enqueue + worker (Phase 1: DB-backed)
│   ├── temporalReevaluator.js       # scheduled maturity sweep
│   ├── rulesetLoader.js             # versioned config loader/cache
│   └── rulesets/default.v1.json     # seed ruleset
├── models/
│   └── engagement.model.js          # NEW thin query layer for derived tables
├── controllers/
│   └── engagement.controller.js     # NEW
├── routes/
│   └── engagement.routes.js         # NEW
└── (existing tracking/* untouched — one enqueue line added to tracking.model.js)

backend/migrations/
└── 003_open_intelligence.sql        # NEW derived + config tables (raw tables untouched)
```

---

## 14. Deliberate non-goals (avoiding over-engineering)

- **No bot-click detection** (per brief — click = human).
- **No heavyweight rules DSL** — a versioned declarative config is enough.
- **No ML on day one** — collect labels first; rules are explainable and cold-start-safe.
- **No Kafka/feature-store now** — Phase 1 is a DB-backed queue + in-process worker.
- **No mutation of raw events, ever.**

---

## 15. Rollout phases

1. **Migration + tables + seed ruleset v1** (derived layer, nothing wired yet).
2. **Engine + signal extractors + unit tests** against synthetic event sets (incl. MPP,
   scanner, direct-client, click cases) — no live dependency.
3. **Queue + worker + the one enqueue line**; backfill-evaluate existing `tracked_emails`.
4. **APIs + dashboard funnel + explainability**.
5. **Temporal sweep + recipient profiles**.
6. **Tuning via shadow rulesets**; later, the ML upgrade.

> ⚠️ **Prerequisite carried over from the tracking hardening backlog:** these new endpoints
> expose engagement data — they must sit behind the **dashboard auth** that's still on the
> "before go-live" list. Don't ship `/api/engagement/*` publicly.

---

## 16. Approved refinements — v2 (2026-07-17)

Five refinements layered on top of v1. They **strengthen** the design; nothing is removed or
simplified. Where v2 conflicts with v1 numbers, **v2 supersedes** (noted inline).

### 16.1 Trust Levels replace numeric proxy weights

- Introduce a first-class **ordinal Trust Level**: `VERY_LOW < LOW < MEDIUM < HIGH < VERIFIED`.
- The ruleset holds two **internal** maps (never exposed to users):
  1. **source/proxy → trust level** — e.g. Apple MPP → `VERY_LOW`; Gmail/Yahoo proxy → `LOW`;
     Microsoft proxy → `LOW`; unknown proxy → `VERY_LOW`; direct (non-proxied) client → `HIGH`;
     human action → `VERIFIED`.
  2. **trust level → internal weight** — used only for aggregation math.
- **`confidence_score` is demoted to internal/debug-only.** Kept for tuning + ML labels, but
  **never returned by any API and never shown on any dashboard.** The public contract is
  entirely symbolic: stage + level + dominant trust level + evidence.
- **Why:** a number like "62%" fakes precision on an inherently uncertain signal. Trust tiers
  are honest and explainable, and we can retune the internal weights without changing the
  vocabulary users see. *(Supersedes the float weights in §4 `proxyTrust` and the numeric
  formula in §5 — those numbers now live only inside the ruleset.)*

### 16.2 New signal: `behaviorConsistency`

- New pure extractor `signals/behaviorConsistency.js`. **Distinct from `openPattern`** (which
  measures spread *within one email*): this looks **across the recipient's history** for a
  **human routine**.
- **Human-like → raises evidence:** opens recur at consistent human times with natural jitter
  (Mon 9:05, Tue 9:08, Wed 9:11).
- **Machine-like → lowers evidence:** near-constant intervals, sub-second regularity,
  burst-at-send, or identical fingerprints across sends.
- **Output:** a trust-level contribution + an **explainable** evidence string
  ("Opens recur ~9 AM weekdays with human jitter — consistent routine" vs
  "Identical 3-second intervals across sends — machine-like").
- **Needs** the recipient's cross-email open history in the engine context (context loader
  expands — see §16.6 worker changes).
- **Guardrail:** raises soft evidence only; can never reach `VERIFIED`.

### 16.3 Campaign Intelligence (decoupled, optional)

- Adds a **campaign grain** beside the per-email grain, using the existing (nullable)
  `tracked_emails.campaign_id`.
- A **separate `campaignAnalyzer` service** computes a **`campaign_engagement_profile`** on a
  schedule / on batch completion: open-time distribution, % opened within N seconds, dispersion
  (entropy) of open times, and a **machine-likelihood trust classification**:
  - *950 / 1000 proxy opens within 3 s* → `MACHINE_DOMINATED`
  - *opens naturally spread over hours* → `HUMAN_DISTRIBUTED`
- A **new optional extractor `signals/campaignSignal.js`** *reads* that precomputed profile and
  contributes to — or caps — the per-email verdict (a `MACHINE_DOMINATED` campaign dampens
  open-trust for its emails). It **never overrides a human action**, and is only consulted when
  `campaign_id` is present; if the profile is missing it returns **neutral**.
- **Decoupling (the key requirement):** the per-email engine never computes campaign stats
  inline — it only *reads* a cached profile. The engine stays per-email and fast; campaign
  analysis is a separate batch job. This is deliberately loose coupling.
- Campaign intelligence also yields its own **campaign-level verdict** for a campaign dashboard.

### 16.4 Evidence-based dashboard (no numbers)

- Stage **display labels** become the approved vocabulary:
  **Delivered → Open Signal → Likely Viewed → Verified Engagement**
  (internal enum values from §3 remain stable behind a display-label map).
- **No percentages anywhere.** Each stage shows a plain-language explanation + an **evidence
  list** of ✓ / ✗ items derived from the signals, e.g.:
  > **Likely Viewed** — ✓ Gmail proxy detected · ✓ Multiple human-like opens · ✓ Behaviour consistency detected
- Requires the stored `signals` JSON to be structured as a **renderable evidence list** (each
  item: signal, direction ✓/✗, human-readable statement, trust level) — not raw contributions.

### 16.5 Engagement Timeline

- Every tracked email keeps a **chronological, append-only timeline** of stage transitions with
  the evidence that caused each:
  > `09:01 Delivered · 09:03 Open Signal · 11:42 Likely Viewed · 15:08 Verified Engagement`
- **New table `engagement_timeline`** (append-only). The worker appends a row **only when the
  stage ratchets up** (monotonic → the timeline only moves forward). This **replaces the
  optional `engagement_audit`** from v1 (now first-class and always-on).
- Powers the "how did engagement evolve" view and is a natural ML label source (time-to-stage).

---

### 16.6 Exact change-list (as requested)

**Database changes** (new migration `004_engagement_v2.sql`, on top of `003`):
- **NEW** `engagement_timeline` — append-only: `tracked_email_id`, `stage`, `evidence` JSON,
  `occurred_at`. Index `(tracked_email_id, occurred_at)`.
- **NEW** `campaign_engagement_profile` — per campaign: distribution stats, `pct_opened_within_ns`,
  open-time entropy, `machine_likelihood` (trust classification), `computed_at`.
- `email_engagement`: **add** `dominant_trust_level` (symbolic); **`confidence_score` marked
  internal-only** (kept, never exposed).
- `engagement_rulesets.config`: **add** source→trust-level map, trust-level→weight map,
  `behaviorConsistency` params, campaign thresholds.
- `tracked_emails.campaign_id`: no schema change (already nullable) — now **actively used +
  indexed**.
- `signals` JSON: **formalized** as an evidence-list structure.

**New services / jobs:**
- `signals/behaviorConsistency.js` — extractor.
- `signals/campaignSignal.js` — optional extractor.
- `campaignAnalyzer.js` — batch service **+ its own scheduler** (independent of the per-email worker).
- `trustModel.js` — maps source→trust level and trust level→internal weight (from the ruleset).
- `engagementTimelineService.js` — appends transition rows (may be folded into `engagementService`).

**New signal extractors specifically:** `behaviorConsistency`, `campaignSignal`. The existing
six keep their interface; **`proxyTrust` now emits a Trust Level** instead of a float.

**Existing services UNCHANGED:**
- All raw tracking — `recordOpen/Click/Unsub`, `track.controller`, `track.routes`, `htmlEmail`,
  `mimeBuilder`, `trackingService`, `gmailService`, `bounceService` (still only the single
  enqueue line added in the v1 plan).
- `poller.service`, `trackingStats.model`, and the existing analytics dashboard/exports — the
  engagement dashboard is **additive**, not a replacement.

**APIs that change / are added:**
- `GET /api/engagement/:id` — stage + level + `dominant_trust_level` + evidence list; **no number**.
- `GET /api/engagement/:id/explain` — the formalized evidence list.
- **NEW** `GET /api/engagement/:id/timeline` — chronological stage transitions.
- **NEW** `GET /api/engagement/campaign/:campaignId` — campaign verdict + distribution classification.
- `GET /api/analytics/engagement/overview` — funnel by the 4 named stages, **no numbers**.

**Dashboard components that change:**
- Funnel relabelled (Delivered / Open Signal / Likely Viewed / Verified Engagement); numbers removed.
- Per-email: **evidence list** (✓/✗) + **timeline** component.
- **NEW** campaign engagement view (`MACHINE_DOMINATED` vs `HUMAN_DISTRIBUTED`).

**Worker logic changes:**
- **Context loader expands** to also load the recipient's **cross-email open history** (for
  `behaviorConsistency`) and, when `campaign_id` is present, the **campaign profile** (for
  `campaignSignal`).
- Engine reasons in **Trust Levels**; internal numeric weighting is hidden.
- On a **stage ratchet-up**, the worker **appends an `engagement_timeline` row** with the
  triggering evidence.
- **NEW independent scheduler:** `campaignAnalyzer` recomputes `campaign_engagement_profile`
  periodically / on batch completion — separate from the per-email worker.

**Folder additions:**
```
src/engagement/
├── signals/
│   ├── behaviorConsistency.js    # NEW
│   └── campaignSignal.js          # NEW (optional)
├── campaignAnalyzer.js            # NEW (batch + scheduler)
├── trustModel.js                  # NEW (trust-level mapping)
└── engagementTimelineService.js   # NEW (or folded into engagementService)
migrations/004_engagement_v2.sql   # NEW
```
```

---

## 17. Tracking runs even when the AI is off (decoupled from replies)

Engagement **tracking** (recording inbound emails, detecting **replies**, plus opens/clicks)
is decoupled from the AI **reply**:

- The poller records + triggers engagement for **every** inbound email, regardless of the
  global AI toggle or a per-thread pause — a recipient reply is a human signal we always capture.
- The AI **reply** only fires when the AI is **on** AND the thread is **not paused**.
- Emails we don't reply to are recorded but left **UNLABELED ("pending")**, so they're
  **caught up automatically** when the AI is turned back on (the poller re-sees the unlabeled
  email and replies). Each pending email is tracked **once** (guarded by `emailExists`) — no
  re-work loop while the AI is off.

**Result:** replies reach `verified_human` even while the AI is off or a thread is paused, and
verification is always driven by the recipient's reply — never by our AI's response.

**Phase A (done):** `poller.service.js` (pollOnce decoupled; `processMessage` now takes the
email object), `email.model.js` (`emailExists`). No schema change.

**Phase B/C (done):** turning the AI **on** in the dashboard pops up a choice when emails
arrived while it was off — *"N emails arrived while the AI was off — reply to them (catch-up)
or skip them?"*
- **Reply (catch-up):** just enable the AI; the poller replies to the pending (unlabeled) emails.
- **Skip:** `POST /api/dashboard/pending/skip` labels them `AI-Skipped` (handled, no reply), then enable.
- **Cancel:** leaves the AI off.
Endpoints: `GET /api/dashboard/pending` (count of waiting emails), `POST /api/dashboard/pending/skip`.
Files: `dashboard.controller.js` + `dashboard.routes.js` (endpoints), `public/index.html` (popup modal).
