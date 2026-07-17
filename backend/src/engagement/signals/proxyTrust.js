// proxyTrust — the MULTIPLIER signal. Classifies the non-bot opens by how they
// were fetched and derives a dominant Trust Level; the ruleset maps that level to
// an internal weight that scales the whole soft score. Also flags the
// "only Apple MPP" cap (MPP fires for ALL delivered mail → near-worthless).
const { classifyOpenSource, sourceTrustLevel, trustWeight, maxTrust, SOURCE_LABEL } = require("../trustModel");

module.exports = function proxyTrust(view, ruleset) {
  const opens = view.nonBotOpens;
  if (!opens.length) {
    return {
      name: "proxyTrust", dominantTrustLevel: "very_low",
      multiplier: trustWeight("very_low", ruleset), capLevel: null,
      direction: "info", statement: "No human-attributable opens to assess.",
    };
  }
  const keys = opens.map(classifyOpenSource);
  const dominant = keys.map((k) => sourceTrustLevel(k, ruleset)).reduce((a, b) => maxTrust(a, b), "very_low");
  const capLevel = keys.every((k) => k === "apple_mpp") ? "low" : null;

  const distinct = [...new Set(keys)].map((k) => SOURCE_LABEL[k] || k);
  const label = distinct.join(", ");
  return {
    name: "proxyTrust",
    dominantTrustLevel: dominant,
    multiplier: trustWeight(dominant, ruleset),
    capLevel,
    trustLevel: dominant,
    direction: "info",
    statement: `Opens fetched via ${label} → ${dominant.replace("_", " ").toUpperCase()} trust.`,
  };
};
