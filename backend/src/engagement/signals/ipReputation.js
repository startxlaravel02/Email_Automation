// ipReputation — assesses the RECIPIENT's IP, which is only visible on a direct
// (human) open. Proxy opens hide it behind the provider's datacenter IP, so for
// proxy-only we stay neutral (proxyTrust already handles proxy distrust).
const { isDatacenter } = require("../util");

module.exports = function ipReputation(view, ruleset) {
  const direct = view.nonBotOpens.filter((o) => o.source === "human");
  if (!direct.length) {
    return { name: "ipReputation", value: 0.5, direction: "info", statement: "No direct-device IP to assess (proxy fetch hides the recipient's IP)." };
  }
  if (direct.some((o) => isDatacenter(o.ip_address))) {
    return { name: "ipReputation", value: 0.2, direction: "negative", statement: "Direct open from a datacenter IP range — suspicious." };
  }
  return { name: "ipReputation", value: 0.7, direction: "positive", statement: "Direct open from a residential/mobile IP." };
};
