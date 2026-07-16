// Classifies a tracking event as coming from:
//   'human' — a real person's device
//   'proxy' — an email image proxy (e.g. Gmail) that fetches the open pixel;
//             a legit "open" signal, but its device/geo describe Google, not the recipient
//   'bot'   — a link scanner / safe-browsing prefetch, or a pixel prefetch that fires
//             seconds after send (no human could open that fast)
// We keep EVERY event in the DB; this flag just lets the dashboard show human
// engagement instead of machine noise.

// Opens arriving within this many seconds of send are prefetch/caching, not real opens.
const PREFETCH_SECONDS = Number(process.env.TRACKING_PREFETCH_SECONDS || 10);

// IP prefixes owned by Google (image proxy + crawlers + safe browsing) and
// Microsoft 365 mail protection (SafeLinks / EOP). A hit here is a machine.
const MACHINE_IP_PREFIXES = [
  // Google
  "66.249.", "64.233.", "66.102.", "72.14.", "74.125.", "108.177.",
  "142.250.", "142.251.", "172.217.", "172.253.", "173.194.",
  "209.85.", "216.58.", "216.239.",
  "2607:f8b0", "2a00:1450", "2404:6800", "2800:3f0", "2c0f:fb50", "2401:fa00",
  // Microsoft 365 (SafeLinks / Exchange Online Protection)
  "40.92.", "40.93.", "40.94.", "40.95.", "40.107.",
  "52.100.", "52.101.", "52.102.", "52.103.", "104.47.",
];

const PROXY_UA = ["googleimageproxy", "via ggpht.com", "gmailimageproxy", "yahoomailproxy"];
const BOT_UA_RE =
  /(googlebot|bingbot|yandexbot|duckduckbot|facebookexternalhit|slackbot|twitterbot|linkedinbot|telegrambot|discordbot|whatsapp|skypeuripreview|proofpoint|mimecast|barracuda|safelinks|\b(bot|crawler|spider|scanner|preview)\b)/i;

const norm = (s) => String(s || "").toLowerCase();

function isMachineIp(ip) {
  if (!ip) return false;
  const s = norm(ip).replace(/^::ffff:/, ""); // unwrap IPv4-mapped IPv6
  return MACHINE_IP_PREFIXES.some((p) => s.startsWith(p));
}
const isProxyUa = (ua) => PROXY_UA.some((p) => norm(ua).includes(p));
const isBotUa = (ua) => BOT_UA_RE.test(String(ua || ""));

// Returns 'human' | 'proxy' | 'bot'.
function classifyEvent({ eventType, ip, userAgent, secondsSinceSent = null } = {}) {
  const machineIp = isMachineIp(ip);
  const proxyUa = isProxyUa(userAgent);

  if (eventType === "open") {
    // Loaded within seconds of send -> prefetch/cache, not a human.
    if (secondsSinceSent != null && secondsSinceSent >= 0 && secondsSinceSent < PREFETCH_SECONDS) {
      return "bot";
    }
    // Gmail/Yahoo proxies fetch every open — real open signal, but machine-fetched.
    if (proxyUa || machineIp) return "proxy";
    // A non-proxied client (Outlook desktop, Thunderbird…) loaded it directly.
    return "human";
  }

  // Clicks / unsubscribes: only real devices count. Datacenter IPs + scanner UAs are machines.
  if (machineIp || proxyUa || isBotUa(userAgent)) return "bot";
  return "human";
}

module.exports = { classifyEvent };
