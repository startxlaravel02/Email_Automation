// Application service that turns raw tracking data into an engagement verdict:
//   load context (from DB) → run the pure engine → persist (idempotent) →
//   append a timeline row on a stage ratchet-up → refresh the recipient prior on
//   a first VERIFIED transition. This is the ONLY place the engine touches I/O.
const { pool } = require("../config/db");
const model = require("../models/engagement.model");
const engine = require("./engagementEngine");
const { getRuleset } = require("./rulesetLoader");
const recipientProfileService = require("./recipientProfileService");

// Best-effort reply detection: a newer inbound message in the SAME thread arriving
// AFTER we sent implies the recipient replied. (Replies aren't raw tracking events;
// they come back to our inbox and are recorded in `emails` by the poller.)
async function detectReply(te) {
  if (!te.reply_id || !te.sent_at) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM replies r
       JOIN emails e1 ON e1.id = r.email_id
       JOIN emails e2 ON e2.thread_id = e1.thread_id AND e2.id <> e1.id
      WHERE r.id = ? AND e2.email_date > ? LIMIT 1`,
    [te.reply_id, te.sent_at]
  );
  return rows.length > 0;
}

// Build the context object the engine consumes. All DB reads live here; the engine stays pure.
async function loadContext(trackedEmailId) {
  const [teRows] = await pool.query(
    `SELECT id, recipient_email, campaign_id, sent_at, delivery_status, reply_id
       FROM tracked_emails WHERE id = ?`, [trackedEmailId]);
  if (!teRows.length) return null;
  const te = teRows[0];

  const [events] = await pool.query(
    `SELECT id, event_type, source, ip_address, user_agent, email_client,
            device_type, browser, country, city, link_url, created_at
       FROM email_events WHERE tracked_email_id = ? ORDER BY id ASC`, [trackedEmailId]);

  const recipientProfile = await model.getRecipientProfile(te.recipient_email);

  // Cross-email open history for behaviorConsistency (routine detection).
  const [history] = await pool.query(
    `SELECT ev.created_at
       FROM email_events ev
       JOIN tracked_emails t ON t.id = ev.tracked_email_id
      WHERE t.recipient_email = ? AND ev.event_type = 'open' AND ev.source <> 'bot'
      ORDER BY ev.created_at DESC LIMIT 100`, [te.recipient_email]);

  const campaignProfile = te.campaign_id ? await model.getCampaignProfile(te.campaign_id) : null;
  const existing = await model.getEngagement(trackedEmailId);
  const hasReply = await detectReply(te);

  return {
    trackedEmail: te,
    events,
    recipientProfile,
    recipientOpenHistory: history,
    campaignProfile,
    priorStage: existing ? existing.engagement_stage : "delivered",
    hasReply,
    now: new Date(),
    _existing: existing,
  };
}

// Evaluate one tracked email end-to-end. Idempotent: safe to run any number of times.
async function evaluate(trackedEmailId) {
  const ruleset = await getRuleset();
  const ctx = await loadContext(trackedEmailId);
  if (!ctx) return null;

  const verdict = engine.evaluate(ctx, ruleset);
  const existing = ctx._existing;

  await model.upsertEngagement({ trackedEmailId, ...verdict });

  // Timeline grows only on a real upward transition (monotonic) → no duplicates on re-eval.
  if (verdict.ratchetedUp) {
    await model.addTimelineEntry({
      trackedEmailId,
      stage: verdict.stage,
      level: verdict.level,
      evidence: verdict.signals,
      rulesetVersion: verdict.rulesetVersion,
    });
  }

  // Refresh the recipient prior the first time this email becomes VERIFIED.
  const becameVerified = verdict.stage === "verified_human" && (!existing || existing.engagement_stage !== "verified_human");
  if (becameVerified) {
    await recipientProfileService.recompute(ctx.trackedEmail.recipient_email);
  }

  return verdict;
}

// Enqueue engagement evaluation for every tracked email in a given Gmail thread.
// Called by the poller when an inbound message arrives — a recipient reply on a
// thread we've tracked is a human action, so we re-evaluate (detectReply → VERIFIED)
// even when there was never an open or click. No-op if the thread has no tracked send.
async function enqueueForThread(threadId) {
  if (!threadId) return 0;
  const [rows] = await pool.query(
    `SELECT DISTINCT te.id
       FROM tracked_emails te
       JOIN replies r ON r.id = te.reply_id
       JOIN emails e ON e.id = r.email_id
      WHERE e.thread_id = ?`,
    [threadId]
  );
  for (const r of rows) await model.enqueueJob(r.id, 0);
  return rows.length;
}

module.exports = { evaluate, loadContext, enqueueForThread };
