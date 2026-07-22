/**
 * src/services/uspto/tsdrVerifyAndQualify.js
 *
 * Phase 1, script #2: pulls near-deadline candidates from trademark_leads,
 * verifies each one live against TSDR (attorney/email/status), and updates
 * the row with ground truth. Run manually for now (no cron yet).
 *
 * Run:
 *   node src/services/uspto/tsdrVerifyAndQualify.js
 *
 * Env vars used:
 *   USPTO_API_KEY        - required, your TSDR key
 *   TSDR_BATCH_LIMIT      - optional, default 100 (caps one run so it's bounded/resumable)
 *   TSDR_WINDOW_DAYS       - optional, default 45 (candidate deadline window)
 */

require('dotenv').config();
const { fetchTsdrRecord } = require('./tsdrClient');
const trademarkLeadModel = require('../../models/trademarkLead.model');

const BATCH_LIMIT = parseInt(process.env.TSDR_BATCH_LIMIT || '100', 10);
const WINDOW_DAYS = parseInt(process.env.TSDR_WINDOW_DAYS || '45', 10);
const WINDOW_MIN_DAYS = parseInt(process.env.TSDR_WINDOW_MIN_DAYS || '0', 10);
const RATE_LIMIT_MS = 1100; // ~1 req/sec, safely under TSDR's 60/min limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple retry with exponential backoff for transient network/5xx failures. */
async function withRetry(fn, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response && err.response.status;
      const isRetryable = !status || status >= 500 || status === 429;
      if (!isRetryable || attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[tsdr-verify] transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`, err.message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function run() {
  const apiKey = process.env.USPTO_API_KEY;
  if (!apiKey) {
    console.error('[tsdr-verify] USPTO_API_KEY is not set in .env — aborting.');
    process.exit(1);
  }

  console.log(`[tsdr-verify] fetching candidates (window=${WINDOW_MIN_DAYS}-${WINDOW_DAYS}d, limit=${BATCH_LIMIT})...`);
  const candidates = await trademarkLeadModel.getVerificationCandidates({
    windowMinDays: WINDOW_MIN_DAYS,
    windowDays: WINDOW_DAYS,
    limit: BATCH_LIMIT,
  });

  console.log(`[tsdr-verify] ${candidates.length} candidates to verify.`);
  if (!candidates.length) {
    console.log('[tsdr-verify] nothing to do.');
    return;
  }

  let verified = 0, errored = 0, foundNoAttorney = 0, foundDead = 0;

  for (const candidate of candidates) {
    try {
      const record = await withRetry(() => fetchTsdrRecord(candidate.serial_number, apiKey));

      await trademarkLeadModel.updateAfterTsdrVerify(candidate.serial_number, {
        attorney_name: record.attorneyName,
        owner_email: record.ownerEmail,
        status_text: record.statusText,
      });

      verified++;
      if (!record.attorneyName) foundNoAttorney++;
      if (record.isDead) foundDead++;

      console.log(
        `[tsdr-verify] ${candidate.serial_number}: attorney=${record.attorneyName || '(none)'} ` +
        `email=${record.ownerEmail || '(none)'} dead=${record.isDead}`
      );
    } catch (err) {
      errored++;
      console.error(`[tsdr-verify] FAILED for ${candidate.serial_number}:`, err.message);
      // Deliberately continue to the next candidate rather than aborting
      // the whole run over one bad serial number.
    }

    const checked = verified + errored;
    if (checked % 200 === 0) {
      console.log(`[tsdr-verify] progress: ${checked}/${candidates.length} checked — ${verified} ok, ${errored} err, ${foundNoAttorney} no-attorney, ${foundDead} dead`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n[tsdr-verify] done.');
  console.log(`  candidates checked:   ${candidates.length}`);
  console.log(`  verified successfully:${verified}`);
  console.log(`  errored (skipped):    ${errored}`);
  console.log(`  confirmed no attorney:${foundNoAttorney}`);
  console.log(`  confirmed dead/cancelled (now excluded going forward): ${foundDead}`);

  const qualified = await trademarkLeadModel.getQualifiedLeads({ limit: 500 });
  console.log(`\n[tsdr-verify] currently qualified & ready for outreach: ${qualified.length}`);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[tsdr-verify] FATAL:', err);
      process.exit(1);
    });
}

module.exports = { run };