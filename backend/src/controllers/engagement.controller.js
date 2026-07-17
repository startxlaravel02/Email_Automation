// HTTP glue for the engagement APIs. Thin — no business logic; reads via the model,
// shapes via the presenter (which hides raw scoring internals).
const model = require("../models/engagement.model");
const presenter = require("../engagement/presenter");

// GET /api/engagement/:id — one email's current engagement verdict + evidence.
async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tracked email id." });
    const row = await model.getEngagementDetail(id);
    if (!row) return res.status(404).json({ success: false, message: "Tracked email not found." });
    res.json({ success: true, engagement: presenter.presentVerdict(row) });
  } catch (err) {
    console.error(`[engagement api] getOne: ${err.message}`);
    res.status(500).json({ success: false, message: "Failed to load engagement." });
  }
}

// GET /api/engagement/:id/timeline — chronological stage evolution.
async function getTimeline(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid tracked email id." });
    const detail = await model.getEngagementDetail(id);
    if (!detail) return res.status(404).json({ success: false, message: "Tracked email not found." });
    const rows = await model.getTimeline(id);
    res.json({ success: true, trackedEmailId: id, timeline: presenter.presentTimeline(rows, detail.sent_at) });
  } catch (err) {
    console.error(`[engagement api] getTimeline: ${err.message}`);
    res.status(500).json({ success: false, message: "Failed to load timeline." });
  }
}

// GET /api/engagement/recipient/:email — a recipient's profile + per-email engagement.
async function getRecipient(req, res) {
  try {
    const email = String(req.params.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Email is required." });
    const [profile, emails] = await Promise.all([
      model.getRecipientProfile(email),
      model.getRecipientEmails(email),
    ]);
    if (!emails.length && !profile) return res.status(404).json({ success: false, message: "No tracked emails for this recipient." });
    res.json({
      success: true,
      recipient: email,
      profile: profile
        ? {
            emailsSent: Number(profile.emails_sent),
            verified: Number(profile.verified_count),
            clicks: Number(profile.click_count),
            unsubscribed: !!profile.unsubscribed,
            lastVerifiedAt: profile.last_verified_at || null,
          }
        : null,
      emails: emails.map(presenter.presentRecipientEmail),
    });
  } catch (err) {
    console.error(`[engagement api] getRecipient: ${err.message}`);
    res.status(500).json({ success: false, message: "Failed to load recipient engagement." });
  }
}

// GET /api/analytics/engagement/overview?from&to — funnel counts by stage.
async function getOverview(req, res) {
  try {
    const range = { from: req.query.from, to: req.query.to };
    const counts = await model.getEngagementOverview(range);
    res.json({ success: true, ...presenter.presentOverview(counts, range) });
  } catch (err) {
    console.error(`[engagement api] getOverview: ${err.message}`);
    res.status(500).json({ success: false, message: "Failed to load engagement overview." });
  }
}

module.exports = { getOne, getTimeline, getRecipient, getOverview };
