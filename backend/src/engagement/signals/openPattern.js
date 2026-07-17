// openPattern — INTRA-email: how many distinct non-bot opens and how they spread.
// Multiple opens spread over time = positive (diminishing returns). Near-constant
// machine intervals = discounted.
const { isMachineRegular, humanizeDuration } = require("../util");

module.exports = function openPattern(view, ruleset) {
  const opens = view.nonBotOpens;
  if (opens.length === 0) return { name: "openPattern", value: 0, direction: "info", statement: "No human-attributable opens." };
  if (opens.length === 1) return { name: "openPattern", value: 0.4, direction: "info", statement: "Single open — limited pattern." };

  const times = opens.map((o) => o._t.getTime()).sort((a, b) => a - b);
  const spanSec = (times[times.length - 1] - times[0]) / 1000;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 1000);

  const varSec = (ruleset.behaviorConsistency || {}).machineIntervalVarianceSeconds || 5;
  if (isMachineRegular(gaps, varSec)) {
    return { name: "openPattern", value: 0.2, direction: "negative", statement: `${opens.length} opens at near-constant intervals — machine-like.` };
  }
  const countScore = Math.min(1, Math.log2(opens.length + 1) / 2); // 2→0.79, 3→1.0
  const spreadScore = Math.min(1, spanSec / 86400); // spread over ≥1 day → 1
  const value = Math.min(1, 0.5 * countScore + 0.5 * spreadScore);
  return { name: "openPattern", value, direction: "positive", statement: `${opens.length} opens spread over ${humanizeDuration(spanSec)} — natural pattern.` };
};
