const {
  searchMessages,
  getRawMessage,
  getOrCreateLabelId,
  addLabel,
} = require("./gmailService");
const { recordBounce } = require("../models/tracking.model");

const PROCESSED_LABEL = "Bounce-Processed";
const INTERVAL = Number(process.env.BOUNCE_SCAN_INTERVAL_MS || 60000);

// Pull the failed recipient address out of a bounce notice (best-effort).
function extractFailedRecipient(raw) {
  const patterns = [
    /X-Failed-Recipients:\s*([^\s,;]+@[^\s,;]+)/i,
    /Final-Recipient:\s*rfc822;\s*([^\s,;]+@[^\s,;]+)/i,
    /wasn't delivered to\s*<?([^\s,;<>]+@[^\s,;<>]+)>?/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1].trim().toLowerCase().replace(/[>.,;]+$/, "");
  }
  return null;
}

// One scan pass: find new bounce notices, match + mark them.
async function scanBounces() {
  const query =
    `(from:mailer-daemon OR from:postmaster) newer_than:3d -label:"${PROCESSED_LABEL}"`;
  const messages = await searchMessages(query, 20);
  if (!messages.length) return;

  const labelId = await getOrCreateLabelId(PROCESSED_LABEL);

  for (const msg of messages) {
    try {
      const raw = await getRawMessage(msg.id);
      const recipient = extractFailedRecipient(raw);
      if (recipient) {
        const matched = await recordBounce(recipient);
        console.log(
          matched
            ? `[bounce] ${recipient} → marked bounced + suppressed`
            : `[bounce] ${recipient} → no matching sent email (ignored)`
        );
      } else {
        console.log(`[bounce] couldn't extract recipient from ${msg.id}`);
      }
      await addLabel(msg.id, labelId); // dedupe — don't reprocess this notice
    } catch (err) {
      console.error(`[bounce] error on ${msg.id}: ${err.message}`);
    }
  }
}

// Independent self-scheduling loop (runs even when the AI toggle is off — this
// is passive bookkeeping, not sending).
function startBounceScanning() {
  console.log(`[bounce] scanner started — every ${INTERVAL}ms`);
  const tick = async () => {
    try { await scanBounces(); } catch (err) { console.error(`[bounce] scan error: ${err.message}`); }
    setTimeout(tick, INTERVAL);
  };
  tick();
}

module.exports = { scanBounces, startBounceScanning };
