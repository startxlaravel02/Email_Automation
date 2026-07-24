const express = require("express");

const router = express.Router();

const {
  listRecent,
  listConversations,
  getConversation,
  getConversationMessages,
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
} = require("../controllers/dashboard.controller");

router.get("/emails", listRecent);
router.get("/conversations", listConversations);
router.get("/conversations/:threadId", getConversation);
router.get("/conversations/:threadId/messages", getConversationMessages);
router.get("/stats", stats);
router.get("/settings", getSettings);
router.post("/settings", updateSettings);
router.post("/threads/:threadId", toggleThread);
router.get("/threads/:threadId/pending", getThreadPending);
router.post("/threads/:threadId/pending/skip", skipThreadPending);
router.post("/threads/:threadId/pending/catchup", catchupThreadPending);
router.get("/pending", getPending);
router.post("/pending/skip", skipPending);
router.post("/pending/catchup", catchupPending);

module.exports = router;
