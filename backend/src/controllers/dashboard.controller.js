const { getRecentEmails, getStats } = require("../models/email.model");
const { isAiEnabled, setAiEnabled } = require("../models/settings.model");
const { setThreadPaused } = require("../models/thread.model");
const { listUnprocessedMessages, getOrCreateLabelId, addLabel } = require("../services/gmailService");

const LABEL = process.env.PROCESSED_LABEL || "AI-Processed";
const SKIPPED_LABEL = process.env.SKIPPED_LABEL || "AI-Skipped";
const ACTION_LABEL = process.env.ACTION_REQUIRED_LABEL || "Action Required";
const PENDING_CAP = 100; // upper bound for the pending count / skip batch

// GET /api/dashboard/emails?limit=50  ->  recent processed emails + reply preview
const listRecent = async (req, res) => {
  try {
    const emails = await getRecentEmails(req.query.limit);
    res.json({ success: true, count: emails.length, emails });
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load dashboard emails" });
  }
};

// GET /api/dashboard/stats  ->  counts by status + total
const stats = async (req, res) => {
  try {
    const data = await getStats();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load stats" });
  }
};

// GET /api/dashboard/settings  ->  the global AI on/off toggle
const getSettings = async (req, res) => {
  try {
    res.json({ success: true, aiEnabled: await isAiEnabled() });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load settings" });
  }
};

// POST /api/dashboard/settings { aiEnabled: bool }  ->  flip the global toggle
const updateSettings = async (req, res) => {
  try {
    if (typeof req.body.aiEnabled === "boolean") {
      await setAiEnabled(req.body.aiEnabled);
    }
    res.json({ success: true, aiEnabled: await isAiEnabled() });
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to update settings" });
  }
};

// POST /api/dashboard/threads/:threadId { paused: bool }  ->  pause/resume the
// AI for one conversation.
const toggleThread = async (req, res) => {
  try {
    const { threadId } = req.params;
    const paused = req.body.paused === true;
    await setThreadPaused(threadId, paused);
    res.json({ success: true, threadId, paused });
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to update conversation" });
  }
};

// GET /api/dashboard/pending  ->  how many inbox emails are waiting (arrived while
// the AI was off / not yet replied). These are the ones "catch-up" would reply to.
const getPending = async (req, res) => {
  try {
    const msgs = await listUnprocessedMessages([LABEL, SKIPPED_LABEL, ACTION_LABEL], PENDING_CAP);
    res.json({ success: true, count: msgs.length, capped: msgs.length >= PENDING_CAP });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load pending count" });
  }
};

// POST /api/dashboard/pending/skip  ->  mark all pending emails handled WITHOUT
// replying (label them AI-Skipped so the poller won't answer them when AI turns on).
const skipPending = async (req, res) => {
  try {
    const skippedLabel = await getOrCreateLabelId(SKIPPED_LABEL);
    const msgs = await listUnprocessedMessages([LABEL, SKIPPED_LABEL, ACTION_LABEL], PENDING_CAP);
    let skipped = 0;
    for (const m of msgs) {
      try {
        await addLabel(m.id, skippedLabel);
        skipped++;
      } catch (e) {
        console.error(`  ↳ skip-label failed for ${m.id}: ${e.message}`);
      }
    }
    res.json({ success: true, skipped });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to skip pending emails" });
  }
};

module.exports = {
  listRecent,
  stats,
  getSettings,
  updateSettings,
  toggleThread,
  getPending,
  skipPending,
};
