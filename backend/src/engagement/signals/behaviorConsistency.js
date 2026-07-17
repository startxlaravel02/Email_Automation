// behaviorConsistency — CROSS-email: does the recipient open at consistent human
// times with natural jitter (a routine → positive), or at machine-regular intervals
// (→ negative)? Distinct from openPattern (which is within a single email).
const { isMachineRegular, circularSpreadMinutes } = require("../util");

module.exports = function behaviorConsistency(view, ruleset) {
  const cfg = ruleset.behaviorConsistency || {};
  const min = cfg.minObservations || 3;
  const hist = (view.recipientOpenHistory || [])
    .map((o) => (o.created_at instanceof Date ? o.created_at : new Date(o.created_at)))
    .filter((d) => !isNaN(d));

  if (hist.length < min) {
    return { name: "behaviorConsistency", value: 0.5, direction: "info", statement: `Not enough history (${hist.length}) to judge a routine (neutral).` };
  }

  const times = hist.map((d) => d.getTime()).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 1000);
  if (isMachineRegular(gaps, cfg.machineIntervalVarianceSeconds || 5)) {
    return { name: "behaviorConsistency", value: 0.1, direction: "negative", statement: "Opens recur at near-identical machine intervals — automated." };
  }

  const mins = hist.map((d) => d.getHours() * 60 + d.getMinutes());
  const spread = circularSpreadMinutes(mins);
  const tol = cfg.timeOfDayToleranceMinutes || 45;
  if (spread <= tol) {
    return { name: "behaviorConsistency", value: 0.9, direction: "positive", statement: `Opens cluster around the same time of day (±${Math.round(spread)}m) with natural jitter — human routine.` };
  }
  return { name: "behaviorConsistency", value: 0.5, direction: "info", statement: "No strong routine detected (neutral)." };
};
