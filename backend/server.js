require("dotenv").config();

const app = require("./src/app");
const { startPolling } = require("./src/services/poller.service");
const { testConnection } = require("./src/config/db");
const { ensureSettingsTable } = require("./src/models/settings.model");
const { ensurePausedThreadsTable } = require("./src/models/thread.model");
const { startBounceScanning } = require("./src/services/bounceService");
const { startWorker } = require("./src/engagement/engagementQueue");
const { seedIfAbsent } = require("./src/engagement/rulesetLoader");
const { startCampaignAnalyzer } = require("./src/engagement/campaignAnalyzer");
const { startTemporalReevaluator } = require("./src/engagement/temporalReevaluator");


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Verify the database is reachable + ensure the settings table exists.
    testConnection()
        .then(() => ensureSettingsTable())
        .then(() => ensurePausedThreadsTable())
        .then(() => seedIfAbsent()) // ensure an active engagement ruleset exists
        .catch((err) => console.error(`[db] setup failed: ${err.message}`));

    // Auto-reply poller (Phase 5a) — opt-in via env so it can be turned off.
    if (process.env.POLLING_ENABLED === "true") {
        startPolling();
    }

    if (process.env.BOUNCE_SCAN_ENABLED !== "false") startBounceScanning();

    // Open Intelligence engine — async worker + campaign analyzer + temporal sweep
    // (opt-out the whole engine via ENGAGEMENT_ENABLED=false; each sub-loop has its own toggle).
    if (process.env.ENGAGEMENT_ENABLED !== "false") {
        startWorker();
        if (process.env.CAMPAIGN_ANALYZER_ENABLED !== "false") startCampaignAnalyzer();
        if (process.env.TEMPORAL_REEVAL_ENABLED !== "false") startTemporalReevaluator();
    }

});
