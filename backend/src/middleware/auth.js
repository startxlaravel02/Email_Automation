// Minimal API-key auth for internal dashboard/engagement APIs.
//
// NOTE: this project had NO request-auth middleware before — engagement data must
// not be public (see docs/OPEN_INTELLIGENCE_ENGINE.md §12), so this guards those
// endpoints. It is intentionally simple (a shared key from env); swap it for a real
// user-auth/session system when one exists. Fail-CLOSED: if no key is configured,
// access is denied rather than left open.
//
// Configure:  DASHBOARD_API_KEY=<some-long-random-string>  in .env
// Call with:  Authorization: Bearer <key>   OR   X-API-Key: <key>
const crypto = require("crypto");

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false; // length check first (timingSafeEqual requires equal length)
  return crypto.timingSafeEqual(ab, bb);
}

function extractKey(req) {
  const header = req.get("authorization");
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  return req.get("x-api-key") || null;
}

function requireApiKey(req, res, next) {
  const expected = process.env.DASHBOARD_API_KEY;
  if (!expected) {
    console.error("[auth] DASHBOARD_API_KEY is not set — denying protected API access (fail-closed). Set it in .env.");
    return res.status(503).json({ success: false, message: "API authentication is not configured." });
  }
  const key = extractKey(req);
  if (!key || !safeEqual(key, expected)) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  next();
}

module.exports = { requireApiKey };
