const express = require("express");

const router = express.Router();

const {
  listRecent,
  stats,
  getSettings,
  updateSettings,
  toggleThread,
} = require("../controllers/dashboard.controller");

router.get("/emails", listRecent);
router.get("/stats", stats);
router.get("/settings", getSettings);
router.post("/settings", updateSettings);
router.post("/threads/:threadId", toggleThread);

module.exports = router;
