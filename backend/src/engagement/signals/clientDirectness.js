// clientDirectness — strongest open-side evidence: did the recipient's REAL device
// fetch the pixel (a non-proxied client), rather than an image proxy?
module.exports = function clientDirectness(view, ruleset) {
  const direct = view.nonBotOpens.some((o) => o.source === "human");
  if (direct) {
    return { name: "clientDirectness", value: 1.0, direction: "positive", trustLevel: "high", statement: "Opened from a direct (non-proxied) mail client — the recipient's real device." };
  }
  return { name: "clientDirectness", value: 0.0, direction: "info", statement: "All opens fetched via an image proxy — no direct-device open." };
};
