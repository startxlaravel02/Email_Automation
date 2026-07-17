const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/engagement.controller");

// Order: specific routes before the bare "/:id" so they aren't captured as an id.
router.get("/recipient/:email", ctrl.getRecipient);
router.get("/:id/timeline", ctrl.getTimeline);
router.get("/:id", ctrl.getOne);

module.exports = router;
