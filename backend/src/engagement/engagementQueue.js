// DB-backed async worker (Phase 1 transport — no Redis/BullMQ). A self-scheduling
// loop drains due jobs from engagement_jobs, evaluating each tracked email. Runs
// in-process alongside the pollers. Failures are isolated per job (never crash the loop).
const model = require("../models/engagement.model");
const service = require("./engagementService");

const INTERVAL = Number(process.env.ENGAGEMENT_WORKER_INTERVAL_MS || 3000);
const MAX_PER_TICK = Number(process.env.ENGAGEMENT_WORKER_MAX_PER_TICK || 500);
let started = false;

// Claim + process every due job, up to a per-tick safety cap. Returns count processed.
async function drain() {
  let job;
  let n = 0;
  while ((job = await model.claimNextJob())) {
    try {
      await service.evaluate(job.tracked_email_id);
      await model.completeJob(job.id);
    } catch (err) {
      console.error(`[engagement] job ${job.id} (email ${job.tracked_email_id}) failed: ${err.message}`);
      await model.failJob(job.id, err);
    }
    if (++n >= MAX_PER_TICK) break;
  }
  return n;
}

function startWorker() {
  if (started) return;
  started = true;
  console.log(`[engagement] worker started — every ${INTERVAL}ms`);
  const tick = async () => {
    try {
      const n = await drain();
      if (n) console.log(`[engagement] evaluated ${n} email(s)`);
    } catch (err) {
      console.error(`[engagement] worker tick error: ${err.message}`);
    }
    setTimeout(tick, INTERVAL);
  };
  tick();
}

module.exports = { startWorker, drain };
