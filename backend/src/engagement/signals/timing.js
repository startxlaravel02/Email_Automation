// timing — time from send to the first non-bot open. Instant = machine/prefetch;
// a human-plausible delay = positive evidence.
const { humanizeDuration } = require("../util");

module.exports = function timing(view, ruleset) {
  const t = ruleset.timing || {};
  const first = view.firstNonBotOpen;
  if (!view.sentAt || !first) {
    return { name: "timing", value: 0, direction: "info", statement: "No human-attributable open to time." };
  }
  const secs = (first.getTime() - view.sentAt.getTime()) / 1000;
  if (secs < 0) {
    return { name: "timing", value: 0.3, direction: "info", statement: "Open timestamp precedes send (clock skew) — timing ignored." };
  }
  if (secs < (t.prefetchSeconds || 10)) {
    return { name: "timing", value: 0.0, direction: "negative", statement: `First open ${Math.round(secs)}s after send — too fast for a human (prefetch).` };
  }
  const maxSecs = (t.humanPlausibleMaxHours || 168) * 3600;
  if (secs <= maxSecs) {
    return { name: "timing", value: 1.0, direction: "positive", statement: `First open ${humanizeDuration(secs)} after send — human-plausible timing.` };
  }
  return { name: "timing", value: 0.5, direction: "info", statement: `First open ${humanizeDuration(secs)} after send — very delayed.` };
};
