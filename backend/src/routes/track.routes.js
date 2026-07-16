const express = require("express");

const router = express.Router();

const {
  openPixel,
  clickRedirect,
  unsubscribe,
} = require("../controllers/track.controller");

router.get("/open/:token", openPixel);
router.get("/click/:token/:linkId", clickRedirect);
router.get("/unsubscribe/:token", unsubscribe);

module.exports = router;
