const express = require("express");
const router = express.Router();
const { getDashboard , searchRecipients , recipientDetail} = require("../controllers/analytics.controller");
const { exportReport } = require("../controllers/export.controller");

router.get("/export", exportReport);
router.get("/dashboard", getDashboard);
router.get("/recipients", searchRecipients);
router.get("/recipient", recipientDetail);


module.exports = router;
