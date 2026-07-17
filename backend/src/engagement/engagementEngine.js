// The Open Intelligence engine — PURE and deterministic. Given a context (raw
// events + recipient/campaign context + prior stage + evaluation time) and the
// active ruleset, it returns an explainable engagement verdict. No I/O, no DB,
// no clock access (time is passed in) — so it's trivially unit-testable and its
// output depends only on its inputs.
//
// Guarantees:
//   • Only a real human action (click/reply/unsubscribe, non-bot) reaches VERIFIED.
//   • Soft signals are capped strictly below VERIFIED (bands.softCeiling).
//   • Stage is a monotonic ratchet — it never downgrades below the prior stage.
//   • Every verdict carries an evidence list; numbers stay internal.
const { clampNum, round3 } = require("./util");

const proxyTrust = require("./signals/proxyTrust");
const timing = require("./signals/timing");
const openPattern = require("./signals/openPattern");
const clientDirectness = require("./signals/clientDirectness");
const ipReputation = require("./signals/ipReputation");
const recipientHistory = require("./signals/recipientHistory");
const behaviorConsistency = require("./signals/behaviorConsistency");
const campaignSignal = require("./signals/campaignSignal");

const STAGE_ORDER = ["delivered", "open_signal", "likely_engaged", "verified_human"];
const stageRank = (s) => STAGE_ORDER.indexOf(s);
const maxStage = (a, b) => (stageRank(a) >= stageRank(b) ? a : b);
const STAGE_FLOOR_LEVEL = { delivered: "none", open_signal: "low", likely_engaged: "medium", verified_human: "verified" };

const LEVEL_ORDER = ["none", "low", "medium", "high", "verified"];
const levelRank = (l) => LEVEL_ORDER.indexOf(l);
const maxLevel = (a, b) => (levelRank(a) >= levelRank(b) ? a : b);
const minLevel = (a, b) => (levelRank(a) <= levelRank(b) ? a : b);

const toDate = (x) => {
  if (!x) return null;
  const d = x instanceof Date ? x : new Date(x);
  return isNaN(d) ? null : d;
};
const evi = (s) => ({ signal: s.name, direction: s.direction, trustLevel: s.trustLevel || null, statement: s.statement });

function actionStatement(a) {
  if (a.event_type === "click") return `Clicked a tracked link${a.link_url ? ` (${a.link_url})` : ""}.`;
  if (a.event_type === "unsubscribe") return "Clicked unsubscribe.";
  if (a.event_type === "reply") return "Replied to the email.";
  return `Performed a ${a.event_type}.`;
}

// Enforce the monotonic stage ratchet against the stored prior stage.
function ratchet(context, r) {
  const prior = context.priorStage || "delivered";
  const finalStage = maxStage(prior, r.stage);
  let level = r.level;
  if (finalStage !== r.stage) {
    // stage was held up by the prior verdict → raise level to that stage's floor for coherence
    level = maxLevel(level, STAGE_FLOOR_LEVEL[finalStage]);
  }
  return {
    stage: finalStage,
    level,
    dominantTrustLevel: r.dominantTrustLevel,
    confidenceScore: r.confidenceScore,
    signals: r.evidence,
    firstSignalAt: r.firstSignalAt,
    verifiedAt: r.verifiedAt,
    lastEventId: r.lastEventId,
    rulesetVersion: r.rulesetVersion,
    ratchetedUp: stageRank(finalStage) > stageRank(prior),
  };
}

function evaluate(context, ruleset) {
  const now = toDate(context.now);
  const events = (context.events || []).map((e) => ({ ...e, _t: toDate(e.created_at) }));
  const evidence = [];
  const lastEventId = events.reduce((m, e) => (e.id && e.id > m ? e.id : m), 0);
  const version = ruleset.version;

  const ha = ruleset.humanAction || {};
  const actionTypes = ha.types || ["click", "unsubscribe", "reply"];
  const excludeBot = ha.excludeBotSource !== false; // default: true

  const opens = events.filter((e) => e.event_type === "open");
  const nonBotOpens = opens.filter((o) => o.source !== "bot").sort((a, b) => (a._t ? a._t.getTime() : 0) - (b._t ? b._t.getTime() : 0));
  const actions = events.filter((e) => actionTypes.includes(e.event_type) && (!excludeBot || e.source !== "bot"));
  const hasReply = !!context.hasReply;

  const sentAt = toDate(context.trackedEmail && context.trackedEmail.sent_at);
  const firstNonBotOpen = nonBotOpens.length ? nonBotOpens[0]._t : null;
  const firstSignalAt = firstNonBotOpen || (opens.length ? toDate(opens[0].created_at) : null);

  // ── OVERRIDE 1: a real human action → VERIFIED (terminal, short-circuit) ──
  if (actions.length || hasReply) {
    actions.forEach((a) => evidence.push({ signal: "humanAction", direction: "positive", trustLevel: "verified", statement: actionStatement(a) }));
    if (hasReply) evidence.push({ signal: "humanAction", direction: "positive", trustLevel: "verified", statement: "Replied to the email." });
    const actionTimes = actions.map((a) => a._t).filter(Boolean).sort((x, y) => x - y);
    return ratchet(context, {
      stage: "verified_human", level: "verified", dominantTrustLevel: "verified", confidenceScore: 1.0,
      evidence, firstSignalAt, verifiedAt: actionTimes[0] || now, lastEventId, rulesetVersion: version,
    });
  }

  // ── No open at all → DELIVERED ──
  if (opens.length === 0) {
    evidence.push({ signal: "delivery", direction: "info", statement: "Delivered — no open signal yet." });
    return ratchet(context, { stage: "delivered", level: "none", dominantTrustLevel: null, confidenceScore: 0, evidence, firstSignalAt: null, verifiedAt: null, lastEventId, rulesetVersion: version });
  }

  // ── Every open is a bot (prefetch/scanner) → OPEN_SIGNAL, no climb ──
  if (nonBotOpens.length === 0) {
    evidence.push({ signal: "botOnly", direction: "negative", trustLevel: "very_low", statement: "Only automated requests (prefetch/scanner) — no human-attributable open." });
    return ratchet(context, { stage: "open_signal", level: "low", dominantTrustLevel: "very_low", confidenceScore: 0.05, evidence, firstSignalAt, verifiedAt: null, lastEventId, rulesetVersion: version });
  }

  // ── Soft-zone scoring ──
  const view = {
    opens, nonBotOpens, sentAt, now, firstNonBotOpen,
    recipientProfile: context.recipientProfile || null,
    recipientOpenHistory: context.recipientOpenHistory || null,
    campaignProfile: context.campaignProfile || null,
  };

  const sProxy = proxyTrust(view, ruleset);
  const sTiming = timing(view, ruleset);
  const sPattern = openPattern(view, ruleset);
  const sClient = clientDirectness(view, ruleset);
  const sIp = ipReputation(view, ruleset);
  const sBehavior = behaviorConsistency(view, ruleset);
  const sHistory = recipientHistory(view, ruleset);
  const sCampaign = campaignSignal(view, ruleset);

  const w = ruleset.signalWeights || {};
  const raw =
    (w.openPattern || 0) * sPattern.value +
    (w.timing || 0) * sTiming.value +
    (w.clientDirectness || 0) * sClient.value +
    (w.ipReputation || 0) * sIp.value +
    (w.behaviorConsistency || 0) * sBehavior.value;

  const nb = ruleset.priorNudge || { min: 0.9, max: 1.15 };
  const nudge = clampNum(sHistory.nudge, nb.min, nb.max);
  const bands = ruleset.bands || {};
  let score = raw * sProxy.multiplier * nudge * (sCampaign.multiplier || 1);
  score = clampNum(score, 0, bands.softCeiling != null ? bands.softCeiling : 0.85);

  let level = score <= (bands.lowMax != null ? bands.lowMax : 0.34) ? "low"
            : score <= (bands.mediumMax != null ? bands.mediumMax : 0.64) ? "medium"
            : "high";

  // caps (only-Apple-MPP, machine-dominated campaign) can only LOWER the level
  let cap = null;
  if (sProxy.capLevel) cap = cap ? minLevel(cap, sProxy.capLevel) : sProxy.capLevel;
  if (sCampaign.capLevel) cap = cap ? minLevel(cap, sCampaign.capLevel) : sCampaign.capLevel;
  if (cap) level = minLevel(level, cap);

  const stage = (ruleset.stageMap || {})[level] || (level === "low" ? "open_signal" : "likely_engaged");

  evidence.push(evi(sProxy), evi(sClient), evi(sTiming), evi(sPattern), evi(sBehavior), evi(sIp), evi(sHistory));
  if (view.campaignProfile) evidence.push(evi(sCampaign));

  return ratchet(context, {
    stage, level, dominantTrustLevel: sProxy.dominantTrustLevel, confidenceScore: round3(score),
    evidence, firstSignalAt, verifiedAt: null, lastEventId, rulesetVersion: version,
  });
}

module.exports = { evaluate, STAGE_ORDER, LEVEL_ORDER };
