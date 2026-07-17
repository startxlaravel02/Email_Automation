// Loads + caches the active ruleset from the DB, and seeds it from the canonical
// file (default.v1.json) if the DB has none yet. Cached briefly so the worker
// doesn't hit the DB on every job; picks up an activated new version within the TTL.
const fs = require("fs");
const path = require("path");
const model = require("../models/engagement.model");

const TTL_MS = Number(process.env.ENGAGEMENT_RULESET_TTL_MS || 60000);
let cache = null;
let cacheAt = 0;

// Ensure an active ruleset exists (idempotent). Returns the active row.
async function seedIfAbsent() {
  const active = await model.getActiveRuleset();
  if (active) return active;
  const file = path.join(__dirname, "rulesets", "default.v1.json");
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  await model.insertRuleset({ version: cfg.version, config: cfg, notes: "auto-seed from default.v1.json", activate: true });
  console.log(`[engagement] seeded ruleset v${cfg.version} from default.v1.json`);
  return await model.getActiveRuleset();
}

// The active ruleset CONFIG object (what the engine consumes). Cached for TTL_MS.
async function getRuleset(force = false) {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL_MS) return cache;
  let active = await model.getActiveRuleset();
  if (!active) active = await seedIfAbsent();
  cache = active.config;
  cacheAt = now;
  return cache;
}

module.exports = { getRuleset, seedIfAbsent };
