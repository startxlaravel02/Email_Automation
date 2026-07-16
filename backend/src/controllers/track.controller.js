const {
  recordOpen,
  recordClick,
  recordUnsubscribe,
} = require("../models/tracking.model");

// A 1x1 transparent GIF (43 bytes) served for every open.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const FALLBACK_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

// req.ip is trustworthy only because we set "trust proxy" in app.js (for Render's X-Forwarded-For).
const clientInfo = (req) => ({
  ip: req.ip || null,
  userAgent: req.get("user-agent") || null,
});

function sendPixel(res) {
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": PIXEL.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.status(200).end(PIXEL);
}

// GET /track/open/:token(.gif)  -> log open, always return the pixel
const openPixel = async (req, res) => {
  const token = String(req.params.token || "").replace(/\.gif$/i, "");
  try {
    await recordOpen(token, clientInfo(req));
  } catch (err) {
    console.error(`[track] open error: ${err.message}`);
  }
  // A broken image must NEVER show in the email — always return the pixel.
  sendPixel(res);
};

// GET /track/click/:token/:linkId  -> log click, 302 to the stored URL
const clickRedirect = async (req, res) => {
  const { token, linkId } = req.params;
  let url = null;
  try {
    url = await recordClick(token, linkId, clientInfo(req));
  } catch (err) {
    console.error(`[track] click error: ${err.message}`);
  }
  // Redirect ONLY to a URL we stored — never to request input (no open-redirect).
  res.redirect(302, url || FALLBACK_URL);
};

// GET /track/unsubscribe/:token  -> record opt-out, show confirmation
const unsubscribe = async (req, res) => {
  try {
    await recordUnsubscribe(req.params.token, clientInfo(req));
  } catch (err) {
    console.error(`[track] unsubscribe error: ${err.message}`);
  }
  res.status(200).set("Content-Type", "text/html").send(
    `<!doctype html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;color:#222">
       <h2>You've been unsubscribed</h2>
       <p>You won't receive further emails from us. If this was a mistake, just reply to any previous email.</p>
     </body></html>`
  );
};

module.exports = { openPixel, clickRedirect, unsubscribe };
