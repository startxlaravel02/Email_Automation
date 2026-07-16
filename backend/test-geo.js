// Quick check that the city database resolves IPs.
//   Run from backend/:  node test-geo.js
// Prints country/city/region for a few sample IPs so you can confirm the .mmdb
// is loading and city data is present before re-testing real emails.
const path = require("path");

const DB =
  process.env.GEOIP_CITY_DB || path.join(__dirname, "data", "dbip-city-lite.mmdb");

const SAMPLES = [
  "8.8.8.8", // Google DNS (US) — should resolve to a city
  "1.1.1.1", // Cloudflare (US/AU)
  "151.101.0.1", // Fastly (US)
  "2407:aa80:15:575c::1", // Pakistan mobile IPv6 (like your click test)
];

(async () => {
  let maxmind;
  try {
    maxmind = require("maxmind");
  } catch (e) {
    console.error("The 'maxmind' package is not installed. Run:  npm i maxmind");
    process.exit(1);
  }

  let db;
  try {
    db = await maxmind.open(DB);
  } catch (e) {
    console.error(`Could not open city DB at: ${DB}`);
    console.error(`Reason: ${e.message}`);
    console.error("Download DB-IP City Lite (.mmdb) and place it there, then re-run.");
    process.exit(1);
  }

  console.log(`Loaded: ${DB}\n`);
  for (const ip of SAMPLES) {
    const r = db.get(ip);
    console.log(ip, "->", {
      country:
        (r && r.country && r.country.iso_code) ||
        (r && r.registered_country && r.registered_country.iso_code) ||
        null,
      region: (r && r.subdivisions && r.subdivisions[0] && r.subdivisions[0].names && r.subdivisions[0].names.en) || null,
      city: (r && r.city && r.city.names && r.city.names.en) || null,
    });
  }
})();
