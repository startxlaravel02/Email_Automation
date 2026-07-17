// Campaign Analyzer — DECOUPLED batch job. Computes a per-campaign engagement
// profile (open-time distribution → machine vs human classification) that the
// per-email `campaignSignal` extractor reads. The per-email engine never computes
// this inline. When a campaign's verdict changes, its emails are re-enqueued so the
// new campaign context is applied. Uses tracked_emails.campaign_id (nullable) — does
// nothing until campaigns are actually assigned (cold-outreach phase).
const { pool } = require("../config/db");
const model = require("../models/engagement.model");
const { getRuleset } = require("./rulesetLoader");

const INTERVAL = Number(process.env.CAMPAIGN_ANALYZER_INTERVAL_MS || 300000); // 5 min
let started = false;

// Normalized Shannon entropy over open-time buckets: 0 = all clustered, 1 = evenly spread.
function normalizedEntropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || counts.length <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  const max = Math.log2(counts.length);
  return max > 0 ? h / max : 0;
}

async function analyzeCampaign(campaignId, ruleset) {
  const cfg = (ruleset && ruleset.campaign) || {};
  const windowSeconds = cfg.windowSeconds || 3;
  const machinePct = cfg.machineDominatedPctWithinWindow || 60;
  const humanPct = cfg.humanDistributedMaxPctWithinWindow || 20;
  const minEmails = cfg.minEmailsForVerdict || 25;

  const [[sent]] = await pool.query(
    `SELECT COUNT(*) AS n FROM tracked_emails WHERE campaign_id = ?`, [campaignId]);
  const emailsSent = Number(sent.n) || 0;

  // All opens (any source) — the campaign-level timing pattern is what matters here.
  const [[o]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(TIMESTAMPDIFF(SECOND, te.sent_at, ev.created_at) BETWEEN 0 AND ?) AS within
       FROM tracked_emails te
       JOIN email_events ev ON ev.tracked_email_id = te.id
      WHERE te.campaign_id = ? AND ev.event_type = 'open'`,
    [windowSeconds, campaignId]);
  const opensTotal = Number(o.total) || 0;
  const within = Number(o.within) || 0;
  const pct = opensTotal ? (within / opensTotal) * 100 : 0;

  const [buckets] = await pool.query(
    `SELECT FLOOR(TIMESTAMPDIFF(SECOND, te.sent_at, ev.created_at) / 3600) AS hb, COUNT(*) AS n
       FROM tracked_emails te
       JOIN email_events ev ON ev.tracked_email_id = te.id
      WHERE te.campaign_id = ? AND ev.event_type = 'open' AND ev.created_at >= te.sent_at
      GROUP BY hb`, [campaignId]);
  const entropy = normalizedEntropy(buckets.map((b) => Number(b.n)));

  let likelihood = "unknown";
  const evidence = [];
  if (emailsSent < minEmails || opensTotal === 0) {
    evidence.push({ direction: "info", statement: `Not enough data for a verdict (${emailsSent} emails, ${opensTotal} opens).` });
  } else if (pct >= machinePct) {
    likelihood = "machine_dominated";
    evidence.push({ direction: "negative", statement: `${Math.round(pct)}% of opens landed within ${windowSeconds}s of send — mass prefetch, not human activity.` });
  } else if (pct <= humanPct) {
    likelihood = "human_distributed";
    evidence.push({ direction: "positive", statement: `Opens are spread naturally over time (only ${Math.round(pct)}% within ${windowSeconds}s of send).` });
  } else {
    likelihood = "mixed";
    evidence.push({ direction: "info", statement: `Mixed opening pattern (${Math.round(pct)}% within ${windowSeconds}s of send).` });
  }

  const prev = await model.getCampaignProfile(campaignId);
  await model.upsertCampaignProfile(campaignId, {
    emailsSent, opensTotal, opensWithinWindow: within, windowSeconds,
    pctWithinWindow: Math.round(pct * 100) / 100,
    openTimeEntropy: Math.round(entropy * 10000) / 10000,
    machineLikelihood: likelihood, evidence,
  });

  // Verdict changed → re-score this campaign's emails so campaignSignal takes effect.
  if (!prev || prev.machine_likelihood !== likelihood) {
    const [emails] = await pool.query(`SELECT id FROM tracked_emails WHERE campaign_id = ?`, [campaignId]);
    for (const e of emails) await model.enqueueJob(e.id, 0);
    if (emails.length) console.log(`[engagement] campaign ${campaignId} → ${likelihood}; re-enqueued ${emails.length} email(s)`);
  }
  return { campaignId, emailsSent, opensTotal, pct: Math.round(pct), likelihood };
}

async function analyzeAll() {
  const ruleset = await getRuleset();
  const [rows] = await pool.query(
    `SELECT DISTINCT campaign_id FROM tracked_emails WHERE campaign_id IS NOT NULL`);
  const results = [];
  for (const r of rows) results.push(await analyzeCampaign(r.campaign_id, ruleset));
  return results;
}

function startCampaignAnalyzer() {
  if (started) return;
  started = true;
  console.log(`[engagement] campaign analyzer started — every ${INTERVAL}ms`);
  const tick = async () => {
    try {
      const res = await analyzeAll();
      if (res.length) console.log(`[engagement] analyzed ${res.length} campaign(s)`);
    } catch (err) {
      console.error(`[engagement] campaign analyzer error: ${err.message}`);
    }
    setTimeout(tick, INTERVAL);
  };
  tick();
}

module.exports = { startCampaignAnalyzer, analyzeAll, analyzeCampaign };
