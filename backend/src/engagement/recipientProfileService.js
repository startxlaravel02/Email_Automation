// Maintains the per-recipient behavioural prior. Recomputed from HARD data only
// (sends, human clicks, VERIFIED emails, unsubscribes) — never from soft opens, so
// there is no confidence-inflation feedback loop. Recompute-from-truth = idempotent.
const { pool } = require("../config/db");
const model = require("../models/engagement.model");

async function recompute(email) {
  const [[sent]] = await pool.query(
    `SELECT COUNT(*) AS n FROM tracked_emails WHERE recipient_email = ?`, [email]);
  const [[clicks]] = await pool.query(
    `SELECT COUNT(DISTINCT te.id) AS n
       FROM tracked_emails te
       JOIN email_events ev ON ev.tracked_email_id = te.id
      WHERE te.recipient_email = ? AND ev.event_type = 'click' AND ev.source <> 'bot'`, [email]);
  const [[verified]] = await pool.query(
    `SELECT COUNT(*) AS n, MAX(en.verified_at) AS last_verified
       FROM tracked_emails te
       JOIN email_engagement en ON en.tracked_email_id = te.id
      WHERE te.recipient_email = ? AND en.engagement_stage = 'verified_human'`, [email]);
  const [[unsub]] = await pool.query(
    `SELECT COUNT(*) AS n FROM suppressed_recipients WHERE email = ? AND reason = 'unsubscribed'`, [email]);

  const emailsSent = Number(sent.n) || 0;
  const verifiedCount = Number(verified.n) || 0;
  const score = emailsSent ? Math.min(1, verifiedCount / emailsSent) : 0;

  await model.upsertRecipientProfile(email, {
    emailsSent,
    verifiedCount,
    clickCount: Number(clicks.n) || 0,
    replyCount: 0, // not used by the engine; thread-based reply count is a later refinement
    unsubscribed: Number(unsub.n) > 0,
    avgSecondsToAction: null, // later refinement
    historicalEngagementScore: Math.round(score * 1000) / 1000,
    lastVerifiedAt: verified.last_verified || null,
  });
}

module.exports = { recompute };
