const { getRecentEmails, getStats } = require("../models/email.model");
const { isAiEnabled, setAiEnabled } = require("../models/settings.model");
const { setThreadPaused } = require("../models/thread.model");

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

module.exports = {
  listRecent,
  stats,
  getSettings,
  updateSettings,
  toggleThread,
};
