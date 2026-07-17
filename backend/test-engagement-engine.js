// Unit tests for the Open Intelligence engine — PURE, no DB, no network.
//   Run:  node test-engagement-engine.js
// Loads the canonical ruleset from src/engagement/rulesets/default.v1.json and
// drives the engine through synthetic event sets, asserting stage + level. This
// is the primary way to verify Phase 2 (the engine core) in isolation.
const path = require("path");
const fs = require("fs");
const { evaluate } = require("./src/engagement/engagementEngine");

const RULESET = JSON.parse(
  fs.readFileSync(path.join(__dirname, "src/engagement/rulesets/default.v1.json"), "utf8")
);

const SENT = new Date("2026-07-15T09:00:00");
const NOW = new Date("2026-07-17T15:00:00");
const at = (base, ms) => new Date(base.getTime() + ms);
const H = 3600e3, MIN = 60e3, S = 1e3, DAY = 86400e3;

let _id = 0;
function ev(type, o = {}) {
  return {
    id: ++_id, event_type: type, source: o.source || "proxy",
    email_client: o.email_client || null, ip_address: o.ip || null,
    user_agent: o.ua || null, link_url: o.link_url || null, created_at: o.at || SENT,
  };
}

// Three Gmail-proxy opens on consecutive mornings ~9am with real human jitter
// (intervals genuinely VARY — 09:05, next day 09:12, third day 08:58 — so they read
// as a routine, not a constant machine cadence).
const routineOpens = [
  ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.1", at: at(SENT, 5 * MIN) }),
  ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.2", at: at(SENT, DAY + 12 * MIN) }),
  ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.3", at: at(SENT, 2 * DAY - 2 * MIN) }),
];
const routineHistory = routineOpens.map((o) => ({ created_at: o.created_at }));

const CASES = [
  {
    name: "Delivered, no events",
    ctx: { events: [], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "delivered", level: "none" },
  },
  {
    name: "Single Gmail proxy open (+2h)",
    ctx: { events: [ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.1", at: at(SENT, 2 * H) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "open_signal", level: "low", trust: "low" },
  },
  {
    name: "Gmail proxy over 3 days + routine + prior engagement",
    ctx: { events: routineOpens, recipientOpenHistory: routineHistory, recipientProfile: { emails_sent: 5, verified_count: 2 }, trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "likely_engaged", level: "medium" },
    show: true,
  },
  {
    name: "Apple MPP open (capped)",
    ctx: { events: [ev("open", { source: "proxy", email_client: "Apple Mail", ip: "17.58.1.1", at: at(SENT, 2 * H) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "open_signal", level: "low", trust: "very_low" },
  },
  {
    name: "All-bot opens (prefetch/scanner)",
    ctx: { events: [ev("open", { source: "bot", ip: "66.249.93.5", at: at(SENT, 3 * S) }), ev("open", { source: "bot", ip: "66.249.93.6", at: at(SENT, 4 * S) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "open_signal", level: "low", trust: "very_low" },
  },
  {
    name: "Direct (non-proxied) client open (+1h)",
    ctx: { events: [ev("open", { source: "human", email_client: "Outlook", ip: "39.50.1.1", at: at(SENT, 1 * H) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "likely_engaged", level: "high", trust: "high" },
    show: true,
  },
  {
    name: "Click (human) → VERIFIED",
    ctx: { events: [ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.1", at: at(SENT, 2 * H) }), ev("click", { source: "human", ip: "39.50.1.1", link_url: "https://startxdigital.com", at: at(SENT, 2 * H + MIN) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "open_signal" },
    expect: { stage: "verified_human", level: "verified" },
  },
  {
    name: "Bot click + Gmail open → NOT verified",
    ctx: { events: [ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.1", at: at(SENT, 2 * H) }), ev("click", { source: "bot", ip: "66.249.93.9", at: at(SENT, 2 * H + 3 * S) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "open_signal", level: "low" },
  },
  {
    name: "Unsubscribe (human) → VERIFIED",
    ctx: { events: [ev("unsubscribe", { source: "human", ip: "39.50.1.1", at: at(SENT, 3 * H) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "verified_human", level: "verified" },
  },
  {
    name: "Reply → VERIFIED",
    ctx: { events: [], hasReply: true, trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "open_signal" },
    expect: { stage: "verified_human", level: "verified" },
  },
  {
    name: "Machine-dominated campaign dampens opens",
    ctx: { events: routineOpens, recipientOpenHistory: routineHistory, recipientProfile: { emails_sent: 5, verified_count: 2 }, campaignProfile: { machine_likelihood: "machine_dominated" }, trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "delivered" },
    expect: { stage: "open_signal", level: "low" },
  },
  {
    name: "Monotonic ratchet (prior likely_engaged never downgrades)",
    ctx: { events: [ev("open", { source: "proxy", email_client: "Gmail", ip: "66.249.93.1", at: at(SENT, 2 * H) })], trackedEmail: { sent_at: SENT }, now: NOW, priorStage: "likely_engaged" },
    expect: { stage: "likely_engaged", level: "medium" },
  },
];

let pass = 0, fail = 0;
console.log("Open Intelligence engine — synthetic scenarios\n");
for (const c of CASES) {
  const r = evaluate(c.ctx, RULESET);
  const okStage = r.stage === c.expect.stage;
  const okLevel = c.expect.level ? r.level === c.expect.level : true;
  const okTrust = c.expect.trust ? r.dominantTrustLevel === c.expect.trust : true;
  const ok = okStage && okLevel && okTrust;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      → stage=${r.stage} level=${r.level} trust=${r.dominantTrustLevel} score(internal)=${r.confidenceScore}`);
  if (!ok) console.log(`      ✗ expected stage=${c.expect.stage} level=${c.expect.level || "*"} trust=${c.expect.trust || "*"}`);
  if (c.show) r.signals.forEach((s) => console.log(`        • [${s.direction}] ${s.statement}`));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
