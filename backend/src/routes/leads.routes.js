const express = require("express");

const router = express.Router();

const { listLeads, countLeads, exportLeads } = require("../controllers/leads.controller");

router.get("/", listLeads);
router.get("/count", countLeads);
router.get("/export", exportLeads);

module.exports = router;
