// campaignSignal — OPTIONAL. Reads a precomputed campaign profile (from the
// decoupled campaignAnalyzer) and dampens or supports a per-email verdict. Neutral
// when there is no campaign context. Never overrides a human action.
module.exports = function campaignSignal(view, ruleset) {
  const c = view.campaignProfile;
  if (!c) return { name: "campaignSignal", multiplier: 1.0, capLevel: null, direction: "info", statement: "No campaign context." };

  if (c.machine_likelihood === "machine_dominated") {
    return { name: "campaignSignal", multiplier: 0.5, capLevel: "low", direction: "negative", statement: "Campaign opens are machine-dominated (mass prefetch) — engagement dampened." };
  }
  if (c.machine_likelihood === "human_distributed") {
    return { name: "campaignSignal", multiplier: 1.05, capLevel: null, direction: "positive", statement: "Campaign opens are naturally distributed over time — supports engagement." };
  }
  return { name: "campaignSignal", multiplier: 1.0, capLevel: null, direction: "info", statement: "Campaign engagement mixed/unknown (neutral)." };
};
