const express = require("express");
const router = express.Router();
const { getDashboard , searchRecipients , recipientDetail} = require("../controllers/analytics.controller");
const { exportReport } = require("../controllers/export.controller");
const { getOverview } = require("../controllers/engagement.controller");
const { requireApiKey } = require("../middleware/auth");

router.get("/export", exportReport);
router.get("/dashboard", getDashboard);
router.get("/recipients", searchRecipients);
router.get("/recipient", recipientDetail);

// Engagement funnel — behind API-key auth (private engagement data).
router.get("/engagement/overview", requireApiKey, getOverview);


module.exports = router;
