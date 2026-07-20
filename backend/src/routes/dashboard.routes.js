const express = require("express");

const router = express.Router();

const {
  listRecent,
  stats,
  getSettings,
  updateSettings,
  toggleThread,
  getPending,
  skipPending,
} = require("../controllers/dashboard.controller");

router.get("/emails", listRecent);
router.get("/stats", stats);
router.get("/settings", getSettings);
router.post("/settings", updateSettings);
router.post("/threads/:threadId", toggleThread);
router.get("/pending", getPending);
router.post("/pending/skip", skipPending);

module.exports = router;
