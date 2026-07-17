// Backfill / re-score engagement for existing tracked emails.
//   Run:  node backfill-engagement.js
// Idempotent — safe to run repeatedly. Evaluates every tracked email through the
// engine and persists its verdict + timeline. Also a convenient way to test the
// whole engagement pipeline against real data without waiting for the worker.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { pool } = require("./src/config/db");
const { seedIfAbsent } = require("./src/engagement/rulesetLoader");
const model = require("./src/models/engagement.model");
const service = require("./src/engagement/engagementService");

(async () => {
  await seedIfAbsent();
  const [rows] = await pool.query(`SELECT id FROM tracked_emails ORDER BY id ASC`);
  console.log(`Backfilling engagement for ${rows.length} tracked email(s)...\n`);

  const dist = {};
  let sampleId = null, sampleRank = -1;
  const STAGE_RANK = { delivered: 0, open_signal: 1, likely_engaged: 2, verified_human: 3 };
  for (const r of rows) {
    const v = await service.evaluate(r.id);
    if (!v) continue;
    dist[v.stage] = (dist[v.stage] || 0) + 1;
    if (STAGE_RANK[v.stage] > sampleRank) { sampleRank = STAGE_RANK[v.stage]; sampleId = r.id; }
  }

  console.log("Stage distribution:", dist);

  if (sampleId) {
    const eng = await model.getEngagement(sampleId);
    const tl = await model.getTimeline(sampleId);
    console.log(`\nExample — tracked_email #${sampleId}`);
    console.log(`  stage=${eng.engagement_stage}  level=${eng.engagement_level}  trust=${eng.dominant_trust_level}`);
    console.log("  evidence:");
    (eng.signals || []).forEach((s) => console.log(`    • [${s.direction}] ${s.statement}`));
    console.log(`  timeline (${tl.length}):`);
    tl.forEach((t) => console.log(`    ${new Date(t.occurred_at).toISOString().slice(0, 19).replace("T", " ")}  →  ${t.stage} / ${t.level}`));
  }

  await pool.end();
  console.log("\nBackfill complete.");
})().catch((e) => { console.error(e); process.exit(1); });
