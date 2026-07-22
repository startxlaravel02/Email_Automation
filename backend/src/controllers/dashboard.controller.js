const { getRecentEmails, getStats } = require("../models/email.model");
const { isAiEnabled, setAiEnabled } = require("../models/settings.model");
const { setThreadPaused } = require("../models/thread.model");
const { searchMessages, getOrCreateLabelId, addLabel, removeLabel } = require("../services/gmailService");

const SKIPPED_LABEL = process.env.SKIPPED_LABEL || "AI-Skipped";
const PENDING_LABEL = process.env.PENDING_LABEL || "AI-Pending";
const PENDING_CAP = 100; // upper bound for the pending count / skip / catch-up batch
const PENDING_QUERY = `label:"${PENDING_LABEL}"`;

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

// --- Pending backlog (emails tracked-only while AI off, or a thread paused) ---
// "Pending" = the AI-Pending Gmail label. Everything below optionally scopes to one
// thread, so the SAME catch-up/skip flow serves both the global AI toggle AND a single
// paused conversation being resumed.

// List pending message ids, optionally only those on one thread.
async function listPendingMsgs(threadId) {
  const msgs = await searchMessages(PENDING_QUERY, PENDING_CAP);
  return threadId ? msgs.filter((m) => m.threadId === threadId) : msgs;
}

// Skip: mark handled WITHOUT replying — add AI-Skipped, drop AI-Pending.
async function doSkip(msgs) {
  const skippedLabel = await getOrCreateLabelId(SKIPPED_LABEL);
  const pendingLabel = await getOrCreateLabelId(PENDING_LABEL);
  let n = 0;
  for (const m of msgs) {
    try {
      await addLabel(m.id, skippedLabel);
      await removeLabel(m.id, pendingLabel);
      n++;
    } catch (e) {
      console.error(`  ↳ skip-label failed for ${m.id}: ${e.message}`);
    }
  }
  return n;
}

// Catch-up: drop AI-Pending so the poller re-lists and answers them. The caller MUST
// have already enabled the AI (global on / thread resumed), or they'd just get re-pended.
async function doCatchup(msgs) {
  const pendingLabel = await getOrCreateLabelId(PENDING_LABEL);
  let n = 0;
  for (const m of msgs) {
    try {
      await removeLabel(m.id, pendingLabel);
      n++;
    } catch (e) {
      console.error(`  ↳ catchup-unlabel failed for ${m.id}: ${e.message}`);
    }
  }
  return n;
}

// GET /api/dashboard/pending  (global) -> count of all pending emails
const getPending = async (req, res) => {
  try {
    const msgs = await listPendingMsgs();
    res.json({ success: true, count: msgs.length, capped: msgs.length >= PENDING_CAP });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load pending count" });
  }
};

// GET /api/dashboard/threads/:threadId/pending -> count pending on ONE conversation
const getThreadPending = async (req, res) => {
  try {
    const msgs = await listPendingMsgs(req.params.threadId);
    res.json({ success: true, count: msgs.length, capped: msgs.length >= PENDING_CAP });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load pending count" });
  }
};

// POST /api/dashboard/pending/skip        (global)
const skipPending = async (req, res) => {
  try {
    const skipped = await doSkip(await listPendingMsgs());
    res.json({ success: true, skipped });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to skip pending emails" });
  }
};

// POST /api/dashboard/pending/catchup     (global) — call AFTER turning AI on
const catchupPending = async (req, res) => {
  try {
    const released = await doCatchup(await listPendingMsgs());
    res.json({ success: true, released });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to release pending emails" });
  }
};

// POST /api/dashboard/threads/:threadId/pending/skip
const skipThreadPending = async (req, res) => {
  try {
    const skipped = await doSkip(await listPendingMsgs(req.params.threadId));
    res.json({ success: true, skipped });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to skip pending emails" });
  }
};

// POST /api/dashboard/threads/:threadId/pending/catchup — call AFTER resuming the thread
const catchupThreadPending = async (req, res) => {
  try {
    const released = await doCatchup(await listPendingMsgs(req.params.threadId));
    res.json({ success: true, released });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to release pending emails" });
  }
};

module.exports = {
  listRecent,
  stats,
  getSettings,
  updateSettings,
  toggleThread,
  getPending,
  getThreadPending,
  skipPending,
  catchupPending,
  skipThreadPending,
  catchupThreadPending,
};
