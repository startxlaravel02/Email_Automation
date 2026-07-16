require("dotenv").config();

const app = require("./src/app");
const { startPolling } = require("./src/services/poller.service");
const { testConnection } = require("./src/config/db");
const { ensureSettingsTable } = require("./src/models/settings.model");
const { ensurePausedThreadsTable } = require("./src/models/thread.model");
const { startBounceScanning } = require("./src/services/bounceService");


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Verify the database is reachable + ensure the settings table exists.
    testConnection()
        .then(() => ensureSettingsTable())
        .then(() => ensurePausedThreadsTable())
        .catch((err) => console.error(`[db] setup failed: ${err.message}`));

    // Auto-reply poller (Phase 5a) — opt-in via env so it can be turned off.
    if (process.env.POLLING_ENABLED === "true") {
        startPolling();
    }

    if (process.env.BOUNCE_SCAN_ENABLED !== "false") startBounceScanning();

});
