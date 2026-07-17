// recipientHistory — a bounded NUDGE (multiplier) from the recipient's prior HARD
// actions only (clicks/replies/verifieds). Neutral on cold start. Never fabricates
// a level — it can only gently raise/lower an existing soft score.
module.exports = function recipientHistory(view, ruleset) {
  const p = view.recipientProfile;
  const bounds = ruleset.priorNudge || { min: 0.9, max: 1.15 };
  if (!p || !Number(p.emails_sent)) {
    return { name: "recipientHistory", nudge: 1.0, direction: "info", statement: "No prior history for this recipient (neutral)." };
  }
  const sent = Number(p.emails_sent || 0);
  const verified = Number(p.verified_count || 0);
  if (verified > 0) {
    const rate = Math.min(1, verified / Math.max(1, sent));
    const nudge = 1 + (bounds.max - 1) * rate;
    return { name: "recipientHistory", nudge, direction: "positive", statement: `Recipient engaged before (${verified}/${sent}) — raises confidence.` };
  }
  if (sent >= 3) {
    return { name: "recipientHistory", nudge: bounds.min, direction: "negative", statement: `Recipient never engaged across ${sent} prior emails — lowers confidence.` };
  }
  return { name: "recipientHistory", nudge: 1.0, direction: "info", statement: "Insufficient history (neutral)." };
};
