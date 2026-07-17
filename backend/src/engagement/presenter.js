// Converts internal engagement rows into the human-readable API shape:
// stage (display label) + level + trust level + an evidence list. Deliberately
// DROPS raw scoring internals (confidence_score, last_event_id, ruleset_version).
const STAGE_LABEL = {
  delivered: "Delivered",
  open_signal: "Open Signal",
  likely_engaged: "Likely Viewed",
  verified_human: "Verified Engagement",
};
const LEVEL_LABEL = { none: "None", low: "Low", medium: "Medium", high: "High", verified: "Verified" };
const TRUST_LABEL = { very_low: "Very Low", low: "Low", medium: "Medium", high: "High", verified: "Verified" };
const SYMBOL = { positive: "✓", negative: "✗", info: "•" };

function presentEvidence(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.map((s) => ({
    direction: s.direction || "info",
    symbol: SYMBOL[s.direction] || "•",
    statement: s.statement,
  }));
}

// Full verdict for one email (row from getEngagementDetail; engagement fields may be
// null if the email was never evaluated → treated as Delivered).
function presentVerdict(row) {
  const stage = row.engagement_stage || "delivered";
  const level = row.engagement_level || "none";
  return {
    trackedEmailId: row.tracked_email_id,
    recipient: row.recipient_email,
    subject: row.subject,
    sentAt: row.sent_at,
    stage,
    stageLabel: STAGE_LABEL[stage] || stage,
    level,
    levelLabel: LEVEL_LABEL[level] || level,
    trustLevel: row.dominant_trust_level || null,
    trustLabel: row.dominant_trust_level ? TRUST_LABEL[row.dominant_trust_level] || row.dominant_trust_level : null,
    firstSignalAt: row.first_signal_at || null,
    verifiedAt: row.verified_at || null,
    lastEvaluatedAt: row.last_evaluated_at || null,
    evidence: presentEvidence(row.signals),
  };
}

// Lightweight per-email row for a recipient's list.
function presentRecipientEmail(row) {
  const stage = row.engagement_stage || "delivered";
  const level = row.engagement_level || "none";
  return {
    trackedEmailId: row.tracked_email_id,
    subject: row.subject,
    sentAt: row.sent_at,
    stage,
    stageLabel: STAGE_LABEL[stage] || stage,
    level,
    trustLevel: row.dominant_trust_level || null,
    verifiedAt: row.verified_at || null,
  };
}

// Chronological timeline. Prepends the implicit "Delivered @ sent_at" baseline.
function presentTimeline(rows, sentAt) {
  const items = [];
  if (sentAt) items.push({ stage: "delivered", stageLabel: STAGE_LABEL.delivered, level: "none", occurredAt: sentAt, evidence: [] });
  for (const t of rows) {
    items.push({
      stage: t.stage,
      stageLabel: STAGE_LABEL[t.stage] || t.stage,
      level: t.level,
      occurredAt: t.occurred_at,
      evidence: presentEvidence(t.evidence),
    });
  }
  return items;
}

// Funnel counts by stage (counts only — no fabricated confidence percentages).
function presentOverview(counts, range) {
  const order = ["delivered", "open_signal", "likely_engaged", "verified_human"];
  const total = order.reduce((s, k) => s + (counts[k] || 0), 0);
  return {
    range: { from: range.from || null, to: range.to || null },
    total,
    funnel: order.map((k) => ({ stage: k, stageLabel: STAGE_LABEL[k], count: counts[k] || 0 })),
  };
}

module.exports = { presentVerdict, presentRecipientEmail, presentTimeline, presentOverview, STAGE_LABEL };
