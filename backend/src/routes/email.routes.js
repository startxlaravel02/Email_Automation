const express = require("express");

const router = express.Router();

const {
  getEmails,
  getEmailById,
  generateReplyForEmail,
  createDraftForEmail,
  sendReplyForEmail,
} = require("../controllers/email.controller");

router.get("/", getEmails);
router.get("/:id", getEmailById);
router.post("/:id/reply", generateReplyForEmail);
router.post("/:id/draft", createDraftForEmail);
router.post("/:id/send", sendReplyForEmail);

module.exports = router;
