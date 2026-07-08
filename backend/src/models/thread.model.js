const { pool } = require("../config/db");

// Per-conversation AI pause. A thread_id present in this table = "AI, stay out
// of this conversation" (a human is handling it). Controlled from the dashboard.
// Auto-created so no extra manual SQL is needed.
async function ensurePausedThreadsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS paused_threads (
       thread_id  VARCHAR(64) PRIMARY KEY,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function isThreadPaused(threadId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM paused_threads WHERE thread_id = ? LIMIT 1`,
    [threadId]
  );
  return rows.length > 0;
}

async function setThreadPaused(threadId, paused) {
  if (paused) {
    await pool.query(
      `INSERT IGNORE INTO paused_threads (thread_id) VALUES (?)`,
      [threadId]
    );
  } else {
    await pool.query(`DELETE FROM paused_threads WHERE thread_id = ?`, [
      threadId,
    ]);
  }
}

module.exports = { ensurePausedThreadsTable, isThreadPaused, setThreadPaused };
