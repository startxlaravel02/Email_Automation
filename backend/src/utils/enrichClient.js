// Derives device / browser / email-client from a User-Agent, and country / city
// from an IP — using free, OFFLINE data (no external API calls, no cost).
//
// City resolution prefers a MaxMind-format .mmdb city database (e.g. DB-IP City
// Lite) when present: it has far better city + IPv6 coverage than geoip-lite's
// bundled data. If the `maxmind` package OR the .mmdb file is missing, we fall
// back to geoip-lite so the app still runs and country still resolves.
const path = require("path");
const uaModule = require("ua-parser-js");
const UAParser = uaModule.UAParser || uaModule; // works for ua-parser-js v1 and v2
const geoip = require("geoip-lite");

// Path to the city database. Override with GEOIP_CITY_DB in .env if you keep it
// elsewhere; default is backend/data/dbip-city-lite.mmdb.
const CITY_DB_PATH =
  process.env.GEOIP_CITY_DB ||
  path.join(__dirname, "..", "..", "data", "dbip-city-lite.mmdb");

// Load the city DB once at startup, asynchronously. `cityDb` stays null if the
// package or file is unavailable — geoLookup() then falls back to geoip-lite.
let cityDb = null;
try {
  const maxmind = require("maxmind");
  maxmind
    .open(CITY_DB_PATH)
    .then((db) => {
      cityDb = db;
      console.log(`[geo] city database loaded: ${CITY_DB_PATH}`);
    })
    .catch((err) => {
      console.warn(
        `[geo] city database not loaded (${err.code || err.message}) — using geoip-lite (country only). ` +
          `Drop the .mmdb at ${CITY_DB_PATH} to enable city lookups.`
      );
    });
} catch (err) {
  console.warn("[geo] 'maxmind' package not installed — using geoip-lite. Run: npm i maxmind");
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Best-effort email-client guess (useful mainly for open-pixel UAs; a normal
// link click just looks like a web browser -> null).
function detectEmailClient(ua) {
  const s = ua.toLowerCase();
  if (s.includes("googleimageproxy")) return "Gmail";
  if (s.includes("outlook") || s.includes("msoffice") || s.includes("microsoft office")) return "Outlook";
  if (s.includes("applemail") || s.includes("apple mail")) return "Apple Mail";
  if (s.includes("yahoo")) return "Yahoo Mail";
  if (s.includes("thunderbird")) return "Thunderbird";
  return null;
}

// Resolve { country, city } for an IP. Prefer the richer .mmdb; fall back to
// geoip-lite. Returns nulls for private/loopback IPs (::1, 127.0.0.1).
function geoLookup(ip) {
  if (cityDb) {
    try {
      const r = cityDb.get(ip);
      if (r) {
        const country =
          (r.country && r.country.iso_code) ||
          (r.registered_country && r.registered_country.iso_code) ||
          null;
        const city = (r.city && r.city.names && r.city.names.en) || null;
        if (country || city) return { country, city };
      }
    } catch (err) {
      // Malformed record / unsupported IP — fall through to geoip-lite.
    }
  }
  const geo = geoip.lookup(ip);
  return {
    country: (geo && geo.country) || null,
    city: (geo && geo.city) || null,
  };
}

function enrichClient({ ip, userAgent } = {}) {
  const out = { deviceType: null, browser: null, emailClient: null, country: null, city: null };

  if (userAgent) {
    const r = new UAParser(userAgent).getResult();
    out.deviceType = r.device && r.device.type ? cap(r.device.type) : "Desktop";
    out.browser = (r.browser && r.browser.name) || null;
    out.emailClient = detectEmailClient(userAgent);
  }

  if (ip) {
    const { country, city } = geoLookup(ip);
    out.country = country;
    out.city = city;
  }

  return out;
}

module.exports = { enrichClient };
