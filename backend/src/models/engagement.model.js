// Thin data-access layer for the Open Intelligence Engine's derived tables.
// Matches the existing model style (raw mysql2 pool, no ORM). Pure persistence —
// no scoring logic lives here (that's the engine/services, later phases).
//
// JSON columns (config, signals, evidence): mysql2 auto-PARSES them on read, but on
// write we must JSON.stringify (passing a JS object would store "[object Object]").
const { pool } = require("../config/db");

// ─── Rulesets (versioned config) ─────────────────────────────────────────

// The single active ruleset (config already parsed to an object). null if none seeded.
async function getActiveRuleset() {
  const [rows] = await pool.query(
    `SELECT version, config, notes, activated_at
       FROM engagement_rulesets WHERE is_active = 1 ORDER BY version DESC LIMIT 1`
  );
  return rows.length ? rows[0] : null;
}

async function getRuleset(version) {
  const [rows] = await pool.query(
    `SELECT version, is_active, config, notes, activated_at FROM engagement_rulesets WHERE version = ?`,
    [version]
  );
  return rows.length ? rows[0] : null;
}

// Insert (or update) a ruleset version; optionally activate it. Idempotent.
async function insertRuleset({ version, config, notes = null, activate = false }) {
  await pool.query(
    `INSERT INTO engagement_rulesets (version, is_active, config, notes)
       VALUES (?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config), notes = VALUES(notes)`,
    [version, JSON.stringify(config), notes]
  );
  if (activate) await activateRuleset(version);
  return version;
}

// Make exactly one version active (transactional).
async function activateRuleset(version) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE engagement_rulesets SET is_active = 0 WHERE is_active = 1`);
    await conn.query(
      `UPDATE engagement_rulesets SET is_active = 1, activated_at = NOW() WHERE version = ?`,
      [version]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── Per-email engagement verdict (derived, overwriteable) ───────────────

async function getEngagement(trackedEmailId) {
  const [rows] = await pool.query(
    `SELECT * FROM email_engagement WHERE tracked_email_id = ?`,
    [trackedEmailId]
  );
  return rows.length ? rows[0] : null;
}

// Upsert the verdict. Caller (service) owns ratchet + high-water-mark decisions;
// first_signal_at / verified_at are preserved once set (COALESCE).
async function upsertEngagement(e) {
  await pool.query(
    `INSERT INTO email_engagement
       (tracked_email_id, engagement_stage, engagement_level, dominant_trust_level,
        confidence_score, signals, ruleset_version, first_signal_at, verified_at,
        last_evaluated_at, last_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       engagement_stage      = VALUES(engagement_stage),
       engagement_level      = VALUES(engagement_level),
       dominant_trust_level  = VALUES(dominant_trust_level),
       confidence_score      = VALUES(confidence_score),
       signals               = VALUES(signals),
       ruleset_version       = VALUES(ruleset_version),
       first_signal_at       = COALESCE(email_engagement.first_signal_at, VALUES(first_signal_at)),
       verified_at           = COALESCE(email_engagement.verified_at, VALUES(verified_at)),
       last_evaluated_at     = NOW(),
       last_event_id         = VALUES(last_event_id)`,
    [
      e.trackedEmailId,
      e.stage || "delivered",
      e.level || "none",
      e.dominantTrustLevel || null,
      e.confidenceScore != null ? e.confidenceScore : 0,
      e.signals ? JSON.stringify(e.signals) : null,
      e.rulesetVersion || null,
      e.firstSignalAt || null,
      e.verifiedAt || null,
      e.lastEventId || 0,
    ]
  );
}

// ─── Engagement timeline (append-only; monotonic stage transitions) ──────

async function addTimelineEntry({ trackedEmailId, stage, level, evidence = null, rulesetVersion = null }) {
  await pool.query(
    `INSERT INTO engagement_timeline (tracked_email_id, stage, level, evidence, ruleset_version)
       VALUES (?, ?, ?, ?, ?)`,
    [trackedEmailId, stage, level, evidence ? JSON.stringify(evidence) : null, rulesetVersion]
  );
}

async function getTimeline(trackedEmailId) {
  const [rows] = await pool.query(
    `SELECT stage, level, evidence, ruleset_version, occurred_at
       FROM engagement_timeline WHERE tracked_email_id = ?
      ORDER BY occurred_at ASC, id ASC`,
    [trackedEmailId]
  );
  return rows;
}

// ─── Recipient behavioural profile (prior; hard-action derived) ──────────

async function getRecipientProfile(email) {
  const [rows] = await pool.query(
    `SELECT * FROM recipient_engagement_profile WHERE recipient_email = ?`,
    [email]
  );
  return rows.length ? rows[0] : null;
}

async function upsertRecipientProfile(email, f = {}) {
  await pool.query(
    `INSERT INTO recipient_engagement_profile
       (recipient_email, emails_sent, verified_count, click_count, reply_count, unsubscribed,
        avg_seconds_to_action, historical_engagement_score, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       emails_sent                 = VALUES(emails_sent),
       verified_count              = VALUES(verified_count),
       click_count                 = VALUES(click_count),
       reply_count                 = VALUES(reply_count),
       unsubscribed                = VALUES(unsubscribed),
       avg_seconds_to_action       = VALUES(avg_seconds_to_action),
       historical_engagement_score = VALUES(historical_engagement_score),
       last_verified_at            = VALUES(last_verified_at)`,
    [
      email,
      f.emailsSent || 0,
      f.verifiedCount || 0,
      f.clickCount || 0,
      f.replyCount || 0,
      f.unsubscribed ? 1 : 0,
      f.avgSecondsToAction != null ? f.avgSecondsToAction : null,
      f.historicalEngagementScore != null ? f.historicalEngagementScore : 0,
      f.lastVerifiedAt || null,
    ]
  );
}

// ─── Campaign-grain engagement profile (computed by campaignAnalyzer) ────

async function getCampaignProfile(campaignId) {
  const [rows] = await pool.query(
    `SELECT * FROM campaign_engagement_profile WHERE campaign_id = ?`,
    [campaignId]
  );
  return rows.length ? rows[0] : null;
}

async function upsertCampaignProfile(campaignId, f = {}) {
  await pool.query(
    `INSERT INTO campaign_engagement_profile
       (campaign_id, emails_sent, opens_total, opens_within_window, window_seconds,
        pct_within_window, open_time_entropy, machine_likelihood, evidence, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       emails_sent         = VALUES(emails_sent),
       opens_total         = VALUES(opens_total),
       opens_within_window = VALUES(opens_within_window),
       window_seconds      = VALUES(window_seconds),
       pct_within_window   = VALUES(pct_within_window),
       open_time_entropy   = VALUES(open_time_entropy),
       machine_likelihood  = VALUES(machine_likelihood),
       evidence            = VALUES(evidence),
       computed_at         = NOW()`,
    [
      campaignId,
      f.emailsSent || 0,
      f.opensTotal || 0,
      f.opensWithinWindow || 0,
      f.windowSeconds || 3,
      f.pctWithinWindow || 0,
      f.openTimeEntropy != null ? f.openTimeEntropy : null,
      f.machineLikelihood || "unknown",
      f.evidence ? JSON.stringify(f.evidence) : null,
    ]
  );
}

// ─── Reads for the engagement APIs ──────────────────────────────────────

// Build a safe date-range fragment for a datetime column (YYYY-MM-DD, parameterized).
function dateRange(column, from, to) {
  const clauses = [];
  const params = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push(`${column} >= ?`); params.push(`${from} 00:00:00`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push(`${column} <= ?`); params.push(`${to} 23:59:59`); }
  return { clause: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

// One email + its engagement (LEFT JOIN — null engagement = never evaluated).
async function getEngagementDetail(trackedEmailId) {
  const [rows] = await pool.query(
    `SELECT te.id AS tracked_email_id, te.recipient_email, te.subject, te.sent_at, te.campaign_id,
            en.engagement_stage, en.engagement_level, en.dominant_trust_level,
            en.signals, en.first_signal_at, en.verified_at, en.last_evaluated_at
       FROM tracked_emails te
       LEFT JOIN email_engagement en ON en.tracked_email_id = te.id
      WHERE te.id = ?`,
    [trackedEmailId]
  );
  return rows.length ? rows[0] : null;
}

// A recipient's tracked emails with their engagement (missing = delivered).
async function getRecipientEmails(email) {
  const [rows] = await pool.query(
    `SELECT te.id AS tracked_email_id, te.subject, te.sent_at,
            COALESCE(en.engagement_stage, 'delivered') AS engagement_stage,
            COALESCE(en.engagement_level, 'none')       AS engagement_level,
            en.dominant_trust_level, en.verified_at
       FROM tracked_emails te
       LEFT JOIN email_engagement en ON en.tracked_email_id = te.id
      WHERE te.recipient_email = ?
      ORDER BY te.id DESC LIMIT 200`,
    [email]
  );
  return rows;
}

// Funnel counts by engagement stage (every tracked email counted; missing = delivered).
async function getEngagementOverview({ from, to } = {}) {
  const { clause, params } = dateRange("te.sent_at", from, to);
  const [rows] = await pool.query(
    `SELECT COALESCE(en.engagement_stage, 'delivered') AS stage, COUNT(*) AS n
       FROM tracked_emails te
       LEFT JOIN email_engagement en ON en.tracked_email_id = te.id
      WHERE ${clause}
      GROUP BY COALESCE(en.engagement_stage, 'delivered')`,
    params
  );
  const counts = { delivered: 0, open_signal: 0, likely_engaged: 0, verified_human: 0 };
  for (const r of rows) counts[r.stage] = Number(r.n);
  return counts;
}

// ─── Evaluation queue (DB-backed; consumed by the worker in a later phase) ──

// Enqueue an evaluation, debounced: if a job is already queued for this email,
// push its run_after out so a burst of opens coalesces into one recompute.
async function enqueueJob(trackedEmailId, debounceSeconds = 5) {
  const [res] = await pool.query(
    `UPDATE engagement_jobs
        SET run_after = NOW() + INTERVAL ? SECOND
      WHERE tracked_email_id = ? AND status = 'queued'`,
    [debounceSeconds, trackedEmailId]
  );
  if (res.affectedRows === 0) {
    await pool.query(
      `INSERT INTO engagement_jobs (tracked_email_id, status, run_after)
         VALUES (?, 'queued', NOW() + INTERVAL ? SECOND)`,
      [trackedEmailId, debounceSeconds]
    );
  }
}

// Atomically claim the next due job (transactional; no SKIP LOCKED, MySQL 5.7-safe).
async function claimNextJob() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, tracked_email_id, attempts FROM engagement_jobs
        WHERE status = 'queued' AND run_after <= NOW()
        ORDER BY id ASC LIMIT 1 FOR UPDATE`
    );
    if (!rows.length) {
      await conn.commit();
      return null;
    }
    const job = rows[0];
    await conn.query(
      `UPDATE engagement_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?`,
      [job.id]
    );
    await conn.commit();
    return job;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function completeJob(id) {
  await pool.query(`UPDATE engagement_jobs SET status = 'done' WHERE id = ?`, [id]);
}

async function failJob(id, err) {
  await pool.query(
    `UPDATE engagement_jobs SET status = 'failed', last_error = ? WHERE id = ?`,
    [String(err && err.message ? err.message : err).slice(0, 500), id]
  );
}

module.exports = {
  // rulesets
  getActiveRuleset, getRuleset, insertRuleset, activateRuleset,
  // per-email verdict
  getEngagement, upsertEngagement,
  // timeline
  addTimelineEntry, getTimeline,
  // recipient profile
  getRecipientProfile, upsertRecipientProfile,
  // campaign profile
  getCampaignProfile, upsertCampaignProfile,
  // API reads
  getEngagementDetail, getRecipientEmails, getEngagementOverview,
  // queue
  enqueueJob, claimNextJob, completeJob, failJob,
};
