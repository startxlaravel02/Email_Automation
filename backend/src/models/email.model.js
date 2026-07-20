const { pool } = require("../config/db");

// Data-access for the dashboard. Thin query layer over mysql2 (no ORM) — easy
// to swap out when the project moves to Nest.js/another stack later.

// Insert an email record (upsert on the unique gmail_id) and return its row id.
async function recordEmail({
  gmailId,
  threadId,
  sender,
  subject,
  snippet,
  status,
  reason = null,
  emailDate = null,
}) {
  const [result] = await pool.query(
    `INSERT INTO emails
       (gmail_id, thread_id, sender, subject, snippet, status, reason, email_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       status = VALUES(status),
       reason = VALUES(reason),
       processed_at = CURRENT_TIMESTAMP`,
    [gmailId, threadId, sender, subject, snippet, status, reason, emailDate]
  );
  return result.insertId;
}

// Insert a reply linked to an email.
async function recordReply({
  emailId,
  body,
  deliveryMode,
  usedContext = false,
  aiMs = null,
}) {
  const [result] = await pool.query(
    `INSERT INTO replies (email_id, body, delivery_mode, used_context, ai_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [emailId, body, deliveryMode, usedContext ? 1 : 0, aiMs]
  );
  return result.insertId;
}

// Recent processed emails with a preview of their latest reply and whether the
// conversation is paused (AI off for that thread).
async function getRecentEmails(limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const [rows] = await pool.query(
    `SELECT e.id, e.gmail_id, e.thread_id, e.sender, e.subject, e.status,
            e.reason, e.email_date, e.processed_at,
            r.delivery_mode, r.used_context, r.ai_ms,
            LEFT(r.body, 300) AS reply_preview,
            (pt.thread_id IS NOT NULL) AS paused
     FROM emails e
     LEFT JOIN replies r
       ON r.id = (SELECT id FROM replies WHERE email_id = e.id ORDER BY id DESC LIMIT 1)
     LEFT JOIN paused_threads pt ON pt.thread_id = e.thread_id
     ORDER BY e.processed_at DESC
     LIMIT ${lim}`
  );
  return rows;
}

// Counts by status + overall total.
async function getStats() {
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS count FROM emails GROUP BY status`
  );
  const byStatus = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.count);
    total += Number(r.count);
  }
  return { total, byStatus };
}

// True if an inbound email (by Gmail id) has already been recorded. Used by the
// poller to track a pending email only once while the AI is off (no re-work loop).
async function emailExists(gmailId) {
  const [rows] = await pool.query(`SELECT 1 FROM emails WHERE gmail_id = ? LIMIT 1`, [gmailId]);
  return rows.length > 0;
}

module.exports = { recordEmail, recordReply, getRecentEmails, getStats, emailExists };
