# AI Email Assistant — Project Context & Handoff

> Paste this whole file into a new chat to resume with full context.
> Last updated: 2026-07-16. Status: Phases 1–4, 5a (polling), attachment triage, thread context, knowledge base, MySQL logging + HTML dashboard + AI on/off toggle + per-conversation pause (MVP), **and a full Email Tracking & Analytics system** — all complete and working.
>
> 📄 **The tracking/analytics work (opens, clicks, geo/city, bot-vs-human classification,
> dashboards, exports, bounces, suppression) is documented in its own file:
> [`TRACKING_AND_ANALYTICS.md`](./TRACKING_AND_ANALYTICS.md).** Sections below §5 predate it.
>
> Also now true (were open items before): a **git repo exists** (initial commit) with
> secrets gitignored; the database is **MySQL** (not MongoDB); the **USPTO lead-gen
> pipeline is paused** (see the tracking doc §13).

---

## 1. What this project is

A **production-grade AI email assistant**. It reads emails from Gmail, understands
them with a **local LLM (Ollama)**, generates professional replies, and (currently)
saves them as Gmail Drafts for review. Local AI was chosen deliberately: no API
cost, privacy, company data stays local.

**Philosophy:** clean architecture, separation of concerns, no business logic in
routes, reusable services, production practices over shortcuts, don't rewrite
working code, don't over-engineer.

---

## 2. Tech stack

- **Backend:** Node.js, Express **5.x**, axios, cors, dotenv, nodemon
- **AI:** Ollama at `http://localhost:11434`, model `llama3.2:3b` (`qwen3:4b` installed as alternative)
- **Email:** Gmail API via `googleapis` + `@google-cloud/local-auth`; OAuth2 **Desktop** credentials; scope `gmail.modify`
- **Database:** **MySQL** via `mysql2` pool — DB `ai_email_assistant`
- **Frontend:** minimal static HTML dashboards in `backend/public/` (React still planned)
- **Tracking libs:** `ua-parser-js`, `geoip-lite` + `maxmind` (DB-IP City .mmdb), `exceljs`, `pdfkit`

---

## 3. Folder structure

```
ai-email/
├── backend/
│   ├── server.js                 # boot only: load env, start app
│   ├── .env                      # config (see §8)
│   ├── credentials.json          # Google OAuth client secret  ⚠ NOT gitignored yet
│   ├── token.json                # OAuth token (mailbox access) ⚠ NOT gitignored yet
│   ├── knowledge/company.md      # editable company facts the AI answers from
│   └── src/
│       ├── app.js                # express app: cors, json, mounts routes
│       ├── config/
│       │   └── knowledge.js      # loads knowledge/company.md + signature
│       ├── middleware/           # (empty — planned)
│       ├── models/               # (empty — planned, for MongoDB)
│       ├── routes/
│       │   ├── ai.routes.js
│       │   └── email.routes.js
│       ├── controllers/
│       │   ├── ai.controller.js
│       │   └── email.controller.js
│       ├── services/
│       │   ├── ollama.service.js # calls Ollama /api/generate (has timeout)
│       │   ├── gmailAuth.js      # OAuth: reads credentials.json/token.json
│       │   ├── gmailService.js   # list/get emails, create draft, labels
│       │   └── poller.service.js # Phase 5a: polling loop -> auto-draft
│       └── utils/
│           ├── emailParser.js    # pure: Gmail payload -> clean email object
│           ├── promptBuilder.js  # pure: builds the LLM prompt
│           ├── mimeBuilder.js    # pure: reply text -> RFC2822 base64url
│           ├── emailFilter.js    # pure: skip no-reply/bulk senders
│           ├── attachments.js    # pure: detect real (non-inline) attachments
│           └── templates.js      # pure: canned holding-reply text
├── docs/                         # this file
└── frontend/                     # (empty — planned React app)
```

**Layering (strict):** `server.js → app.js → routes → controllers → services → utils`.
Routes only map URLs to controllers. Controllers are thin HTTP glue. Services own
external systems (Gmail, Ollama). Utils are pure, testable, no I/O.

---

## 4. Current API endpoints

| Method | Path | Purpose | Body |
|---|---|---|---|
| GET  | `/` | **Minimal HTML dashboard UI** (served static) | — |
| GET  | `/health` | Health check (JSON) | — |
| GET  | `/api/dashboard/emails` | Recent processed emails + reply preview | — |
| GET  | `/api/dashboard/stats` | Counts by status + total | — |
| GET  | `/api/dashboard/settings` | Current AI on/off state | — |
| POST | `/api/dashboard/settings` | Flip the AI on/off toggle | `{ aiEnabled }` |
| POST | `/api/dashboard/threads/:threadId` | Pause/resume AI for one conversation | `{ paused }` |
| POST | `/api/ai/reply` | Reply to a **raw email string** (manual/testing) | `{ "email": "..." }` |
| GET  | `/api/emails` | List 5 recent emails (clean `text`, no html) | — |
| GET  | `/api/emails/:id` | One full email (includes html) | — |
| POST | `/api/emails/:id/reply` | Generate AI reply **preview** (does NOT touch Gmail) | — |
| POST | `/api/emails/:id/draft` | Generate AI reply **and save as Gmail Draft** | — |
| POST | `/api/emails/:id/send` | Generate AI reply **and send it immediately** | — |

**Typical test flow:** `GET /api/emails` → copy an `id` → `POST /api/emails/:id/draft`
→ open Gmail → Drafts → review the AI reply on the thread.

---

## 5. What has been completed

- ✅ Express backend, `server.js`/`app.js` split (app is testable without listening)
- ✅ Ollama integration (`ollama.service.js`) with a request **timeout**
- ✅ Gmail OAuth2 (`gmailAuth.js`) — `credentials.json` → `token.json`, working
- ✅ **Phase 1 — fetch complete emails:** `emailParser.js` recursively walks the
  Gmail MIME tree, base64url-decodes bodies, extracts `from/to/subject/date/
  messageId/snippet/text/html/attachments`. HTML-only emails get a text fallback
  (strips comments/head/scripts, MSO conditionals, collapses whitespace). List
  endpoint returns a lean shape (drops heavy `html`).
- ✅ **Phase 2 — AI reply:** `promptBuilder.js` injects real email content into the
  prompt (fixed a prior bug where `{{EMAIL}}` was never substituted). Includes a
  prompt-injection guardrail (email treated as untrusted content) and input length
  cap (`MAX_EMAIL_CHARS`).
- ✅ **Phase 3 — Gmail Draft:** `mimeBuilder.js` builds a threaded RFC 2822 reply
  (`Re:` subject, `In-Reply-To`/`References`); `gmailService.createDraftReply()`
  calls `gmail.users.drafts.create`. Never sends. Uses existing `gmail.modify`
  scope (no re-consent).
- ✅ **Phase 5a — Auto-reply polling:** `poller.service.js` runs a self-scheduling
  loop (every `POLL_INTERVAL_MS`, default 10s; ticks never overlap). Each cycle:
  find unread inbox emails not tagged with any outcome label → `emailFilter`
  decides → run the pipeline → draft → tag the outcome. Started from `server.js`
  when `POLLING_ENABLED=true`. Delivery mode set by `AUTO_SEND` (draft or send).
  Outcome labels
  (each ≈ one state): `AI-Processed` (replied), `AI-Skipped`
  (newsletter/no-reply/bulk), `Action Required` (attachment → human). The poll
  query excludes all three — that's the dedupe mechanism.
- ✅ **Attachment triage:** if an email has a real (non-inline) attachment the AI
  can't read, the poller drafts a canned **holding reply** ("a representative will
  review and get back to you") and tags the email **`Action Required`** for a
  human — instead of guessing. Tagged **only** `Action Required` (not
  `AI-Processed`); the poll query excludes both labels, so it still isn't
  reprocessed. Inline logos are ignored so newsletters aren't flagged.
  (`utils/attachments.js` + `utils/templates.js`; parser reads
  `Content-Disposition` to tell real vs inline.)
- ✅ **Phase 4 — Auto-send:** `gmailService.sendReply` (`gmail.users.messages.send`)
  sends a reply immediately on the thread. Gated by `AUTO_SEND` (default draft).
  Manual endpoint `POST /api/emails/:id/send`; the poller sends instead of
  drafting when `AUTO_SEND=true`. Also added `keep_alive` to Ollama calls so the
  model stays warm between requests. `gmail.modify` scope already covers send.
- ✅ **Thread context (conversation memory):** for ongoing threads (2+ messages)
  the reply is built from the whole conversation — `gmailService.getThread`
  (+ `getMyAddress` to label us vs customer) → `buildThreadReplyPrompt` with
  sender-labeled history, quoted-tail stripping (`stripQuotedText`), last
  `MAX_THREAD_MESSAGES` msgs. Two-tier truncation: the **latest** message keeps
  full content (`MAX_EMAIL_CHARS`) so the actual request is never lost; older
  history is trimmed to `MAX_MESSAGE_CHARS`. New inquiries
  (1 message) keep the fast single-message path. Verified live: the model used
  prior context ("iOS") and didn't repeat itself (~38s for a 3-message thread).
- ✅ **Knowledge base (answers with real facts):** `knowledge/company.md` (editable
  markdown, dummy data for now) is loaded by `config/knowledge.js` and injected
  into both prompts, so the AI answers with concrete services / pricing /
  documents / process / links instead of endlessly asking. Rules are **directive**
  ("STATE the facts, don't deflect") — small models deflect without this. Also
  provides one consistent signature. Verified live: the trademark thread now
  returns the required documents, fees ($150/$499), timeline (2–4 wks / 6–9 mo),
  and the intake link. Caveats: ~80s/reply on CPU (bigger prompt — GPU fixes it);
  RAG is the future upgrade when the KB outgrows the prompt.
- ✅ **MySQL logging + HTML dashboard (MVP):** `config/db.js` (mysql2 pool),
  `models/email.model.js` (thin query layer — recordEmail/recordReply/
  getRecentEmails/getStats). The poller writes a row per processed email + reply
  (`emails` + `replies` tables, DB `ai_email_assistant`). Read endpoints at
  `GET /api/dashboard/emails` + `/stats`. A minimal static UI at `public/index.html`
  (served at `/`) shows a stats strip + recent-activity table, auto-refreshing.
  Deliberately minimal — will be replaced by Next.js/Nest.js later; the API + DB
  are the parts that stay. Verified live against MySQL (insert/read/stats).
- ✅ **AI on/off toggle (kill switch):** a `settings` table (auto-created on boot)
  holds `ai_enabled`; the poller checks it at the start of every cycle and does
  nothing while OFF (new emails just wait, unprocessed, until back ON). Flip it
  live from the dashboard header button — no `.env` edit, no restart. Endpoints:
  `GET` / `POST /api/dashboard/settings`. `settings.model.js` handles it. Verified
  live (off→on).
- ✅ **Per-conversation AI pause (the PM's key ask):** each conversation has a
  **Pause AI / Resume** button in the dashboard. Pausing writes the `thread_id`
  to a `paused_threads` table (auto-created); the poller checks `isThreadPaused`
  per message (using the thread id from the message list — no extra Gmail call)
  and stays out of paused conversations, current and future messages. Resuming
  lets the pending message be handled on the next cycle. `thread.model.js` +
  `POST /api/dashboard/threads/:threadId {paused}`. Verified live.

Everything above was verified: parser unit-tested against real MIME shapes, prompt
builder confirmed to inject content, MIME builder decoded and checked, full app
require-graph loads with no errors, and the live draft creation was confirmed
working in Gmail.

---

## 6. Config (.env)

```
PORT=5000
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_TIMEOUT=120000      # ms, request timeout to Ollama
OLLAMA_KEEP_ALIVE=30m      # keep model warm between requests ("-1" = forever)
COMPANY_NAME=StartX Digital # company name (used in prompt + signature)
COMPANY_WEBSITE=https://startxdigital.com  # used in the signature
MAX_EMAIL_CHARS=4000       # cap single-email text sent to the model
MAX_THREAD_MESSAGES=5      # thread context: max messages of history included
MAX_MESSAGE_CHARS=1200     # thread context: max chars per message
POLLING_ENABLED=true       # start the auto-reply poller on boot
POLL_INTERVAL_MS=10000     # how often to check for new mail
POLL_MAX_RESULTS=10        # max emails processed per cycle
PROCESSED_LABEL=AI-Processed  # label for emails the AI replied to
SKIPPED_LABEL=AI-Skipped  # label for skipped mail (newsletter/no-reply/bulk)
ACTION_REQUIRED_LABEL=Action Required  # label for attachment emails (human handoff)
AUTO_SEND=false            # true = send immediately; false = draft (set false while tuning KB)
DB_HOST=localhost          # MySQL
DB_PORT=3306
DB_USER=root
DB_PASSWORD=               # set your MySQL password
DB_NAME=ai_email_assistant
```
(All new vars have code defaults, so they're optional.)

---

## 7. How to run

```
cd backend
npm run dev            # nodemon — auto-reloads on file changes (preferred)
# ensure Ollama is running:  ollama serve   (or the Ollama app)
```
⚠️ **After adding a route/file, restart the server** (nodemon usually handles it;
if a new route 404s, do a manual stop/start).

---

## 8. Key design decisions (and why)

- **server/app split** → app can be imported in tests without opening a port.
- **Prompt in a util, not the controller** → versionable prompts (future "Prompt
  Management"), reusable across endpoints, unit-testable.
- **Parser/mime/prompt are pure utils** → MIME/prompt logic is fiddly; isolating
  it with no I/O makes it testable and reusable.
- **Draft-first, never auto-send** → safety while developing. Auto-send is a later,
  flag-gated phase.
- **Prompt-injection guardrail** → a stranger's email is untrusted input feeding an
  LLM whose output triggers an action; the prompt tells the model to ignore
  instructions inside the email body.

---

## 9. Known issues / deferred items (READ before next phase)

1. **✅ Secrets protected (resolved).** A git repo now exists (initial commit) and
   `.gitignore` covers `credentials.json`, `token.json`, `.env`, `node_modules/`, and
   the geo `.mmdb`. (Historical note: these were unprotected before 2026-07.) Still
   verify no secret was committed in the very first commit before pushing anywhere public.
2. **OAuth on a server.** `@google-cloud/local-auth` opens a browser — won't work
   on a headless production server. Need a pre-generated token (as a secret) or a
   service-account/domain-delegation model. Blocker for Phase 5/6 deployment.
3. **Token refresh not persisted.** `gmailAuth.js` doesn't write refreshed tokens
   back to `token.json` and has a couple of unreachable `console.log` lines after a
   `return`. Fine for dev; tighten for prod.
4. **No structured logging** (only `console.error`), **no central error handler**,
   **no validation middleware**, **CORS is wide open**, **no auth** on endpoints.
5. **No database.** Nothing is persisted. Poller dedupe uses the `AI-Processed`
   Gmail label (fine for one account) — move to a DB record at scale. The poller
   also runs **in-process** with the API and processes emails sequentially (fine
   for low volume; separate worker + queue at scale, Phase 6). Don't set
   `POLL_INTERVAL_MS` too low in prod (Gmail API quota).
6. **N+1 Gmail fetch** (list → get per message); fine at `maxResults:5`, needs
   batching + rate-limit awareness at scale.
7. **HTML→text is a basic stripper** — good enough for AI input; swap for a library
   (`html-to-text`) if a dashboard needs faithful rendering.

---

## 10. Roadmap / what's next

- **Phase 4 — Auto-send:** ✅ DONE. `sendReply` via `gmail.users.messages.send`,
  gated by `AUTO_SEND`. Manual `POST /api/emails/:id/send`; poller sends when on.
- **Phase 5a — Auto-receive via polling:** ✅ DONE (see §5). Dedupe via the
  `AI-Processed` label; sender filtering in `emailFilter.js`; draft-only.
- **Phase 5b — Auto-receive via push (production real-time):** Gmail `watch()` +
  Google Pub/Sub + webhook. Needs a public HTTPS URL (ngrok in dev / domain in
  prod) and `watch()` renewal every 7 days. Same pipeline underneath.
- **Phase 6 — Production architecture:**
  - **Queue + Worker** (BullMQ/Redis, or a simpler DB-backed queue) — LLM work must
    not run inside the webhook/request; API and worker as separate processes.
  - **MongoDB** + an **email state machine** (`RECEIVED → CLASSIFIED → DRAFTED →
    PENDING_APPROVAL → APPROVED → SENT / FAILED`) — powers dashboard, retries, audit.
  - Retry/backoff, rate limiting, structured logging, error handling, monitoring.
  - Prompt versioning, AI **confidence scoring**, **manual-approval gate** (a
    low-confidence reply must never auto-send).
- **Frontend (React dashboard):** inbox, AI replies/drafts, approve/reject, logs,
  prompt management, model selection, settings, analytics.

---

## 11. Architectural notes for scaling (agreed earlier)

- Synchronous request/response fits *manual* use, but **not** auto-processing. The
  production shape is **event-driven**: ingest (push/poll) → enqueue → worker
  (classify → draft → confidence → approval gate → send) → persist state.
- The **email lifecycle is a state machine**; persisting transitions is what makes
  the dashboard, approval mode, retries, and audit possible.
- **Idempotency/dedupe** is the highest-risk item once automated — double-replying
  to a customer is not undoable.
- The **approval gate is a security control**, not just UX.
- Keep **provider seams** thin (LLM provider, email provider) without
  over-engineering, so Ollama↔cloud or Gmail↔Outlook can swap later.

---

## 12. Immediate next action

Decide Phase 4 (auto-send, flag-gated) vs Phase 5 (auto-receive). Recommended:
do **Phase 4** first (small, completes the send path safely), then Phase 5.
Before ever committing to git, do item #1 in §9 (protect secrets).
