const express = require("express");

const router = express.Router();

const { listLeads, exportLeads } = require("../controllers/leads.controller");

router.get("/", listLeads);
router.get("/export", exportLeads);

module.exports = router;
