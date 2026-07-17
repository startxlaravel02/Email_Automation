// Trust Level model — the symbolic vocabulary the engine reasons in.
//   Ordinal: very_low < low < medium < high < verified
// Numeric weights are an INTERNAL ruleset detail (never surfaced). This module
// also classifies a raw open event into a "source key" that the ruleset maps to
// a trust level. No I/O; pure.

const ORDER = ["very_low", "low", "medium", "high", "verified"];

const rank = (level) => ORDER.indexOf(level);
const maxTrust = (a, b) => (rank(a) >= rank(b) ? a : b);
const minTrust = (a, b) => (rank(a) <= rank(b) ? a : b);

// Map a raw open event → source key. Honors the existing tracking-layer `source`
// flag (we do NOT re-classify bots here — that's the tracking layer's job).
function classifyOpenSource(ev) {
  if (!ev) return "unknown_proxy";
  if (ev.source === "bot") return "bot";
  if (ev.source === "human") return "direct_client"; // the recipient's real device fetched it
  // ev.source === "proxy"
  const client = String(ev.email_client || "").toLowerCase();
  const ua = String(ev.user_agent || "").toLowerCase();
  const ip = String(ev.ip_address || "");
  if (client.includes("gmail") || ua.includes("googleimageproxy") || ua.includes("ggpht")) return "gmail_proxy";
  if (client.includes("apple") || ip.startsWith("17.")) return "apple_mpp"; // Apple owns 17.0.0.0/8
  if (client.includes("outlook") || client.includes("microsoft") || ua.includes("outlook") || ua.includes("microsoft")) return "microsoft_proxy";
  if (client.includes("yahoo")) return "yahoo_proxy";
  return "unknown_proxy";
}

function sourceTrustLevel(sourceKey, ruleset) {
  return (ruleset.sourceTrust && ruleset.sourceTrust[sourceKey]) || "very_low";
}
function trustWeight(level, ruleset) {
  const w = ruleset.trustWeight && ruleset.trustWeight[level];
  return typeof w === "number" ? w : 0;
}

// Human label for a source key (evidence text).
const SOURCE_LABEL = {
  gmail_proxy: "Gmail image proxy",
  apple_mpp: "Apple Mail Privacy Protection",
  microsoft_proxy: "Microsoft image proxy",
  yahoo_proxy: "Yahoo image proxy",
  unknown_proxy: "an unknown image proxy",
  direct_client: "a direct (non-proxied) mail client",
  bot: "an automated fetcher",
};

module.exports = {
  ORDER, rank, maxTrust, minTrust,
  classifyOpenSource, sourceTrustLevel, trustWeight, SOURCE_LABEL,
};
