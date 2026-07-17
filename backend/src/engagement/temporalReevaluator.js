// Temporal Re-evaluator — scheduled sweep that re-enqueues recent, NON-terminal
// emails whose context may have matured (recipient cross-email history grew, a
// campaign profile changed). It does NOT escalate from elapsed time alone — the
// engine is event-deterministic, so re-evaluating the same events yields the same
// verdict; this only ensures verdicts pick up newer *context*. Bounded per sweep,
// and it logs when it caps (no silent truncation).
const { pool } = require("../config/db");
const model = require("../models/engagement.model");

const INTERVAL = Number(process.env.TEMPORAL_REEVAL_INTERVAL_MS || 1800000); // 30 min
const WINDOW_DAYS = Number(process.env.TEMPORAL_REEVAL_WINDOW_DAYS || 14);
const MIN_AGE_MIN = Number(process.env.TEMPORAL_REEVAL_MIN_AGE_MINUTES || 60);
const BATCH = Number(process.env.TEMPORAL_REEVAL_BATCH || 200);
let started = false;

async function sweep() {
  const [rows] = await pool.query(
    `SELECT te.id
       FROM tracked_emails te
       LEFT JOIN email_engagement en ON en.tracked_email_id = te.id
      WHERE te.sent_at >= (NOW() - INTERVAL ? DAY)
        AND (en.engagement_stage IS NULL OR en.engagement_stage <> 'verified_human')
        AND (en.last_evaluated_at IS NULL OR en.last_evaluated_at < (NOW() - INTERVAL ? MINUTE))
        AND EXISTS (SELECT 1 FROM email_events ev WHERE ev.tracked_email_id = te.id)
      ORDER BY te.id ASC
      LIMIT ?`,
    [WINDOW_DAYS, MIN_AGE_MIN, BATCH + 1]
  );
  const capped = rows.length > BATCH;
  const batch = capped ? rows.slice(0, BATCH) : rows;
  for (const r of batch) await model.enqueueJob(r.id, 0);
  if (batch.length) {
    console.log(
      `[engagement] temporal sweep re-enqueued ${batch.length} email(s)` +
        (capped ? ` (capped at ${BATCH}; more remain — will continue next sweep)` : "")
    );
  }
  return { enqueued: batch.length, capped };
}

function startTemporalReevaluator() {
  if (started) return;
  started = true;
  console.log(`[engagement] temporal re-evaluator started — every ${INTERVAL}ms (window ${WINDOW_DAYS}d, min-age ${MIN_AGE_MIN}m, batch ${BATCH})`);
  const tick = async () => {
    try {
      await sweep();
    } catch (err) {
      console.error(`[engagement] temporal sweep error: ${err.message}`);
    }
    setTimeout(tick, INTERVAL);
  };
  tick();
}

module.exports = { startTemporalReevaluator, sweep };
