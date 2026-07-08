const express = require("express");

const router = express.Router();

const {
    generateEmailReply,
} = require("../controllers/ai.controller");

router.post("/reply", generateEmailReply);

module.exports = router;