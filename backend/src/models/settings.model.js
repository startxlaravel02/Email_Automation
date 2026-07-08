const { pool } = require("../config/db");

// Simple key/value runtime settings (the AI on/off toggle, and room for more).
// Auto-created so no extra manual SQL is needed.
async function ensureSettingsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS settings (
       name       VARCHAR(64) PRIMARY KEY,
       value      VARCHAR(255) NOT NULL,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  // Seed the AI toggle to ON if it doesn't exist yet.
  await pool.query(
    `INSERT IGNORE INTO settings (name, value) VALUES ('ai_enabled', 'true')`
  );
}

async function getSetting(name, fallback = null) {
  const [rows] = await pool.query(`SELECT value FROM settings WHERE name = ?`, [
    name,
  ]);
  return rows.length ? rows[0].value : fallback;
}

async function setSetting(name, value) {
  await pool.query(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [name, String(value)]
  );
}

// The AI auto-reply master switch.
async function isAiEnabled() {
  return (await getSetting("ai_enabled", "true")) === "true";
}

async function setAiEnabled(enabled) {
  await setSetting("ai_enabled", enabled ? "true" : "false");
}

module.exports = {
  ensureSettingsTable,
  getSetting,
  setSetting,
  isAiEnabled,
  setAiEnabled,
};
