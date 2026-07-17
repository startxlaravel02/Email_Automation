const { pool } = require("../config/db");
const { enrichClient } = require("../utils/enrichClient");
const { classifyEvent } = require("../utils/botFilter");
const { enqueueJob } = require("./engagement.model");

// Fire-and-forget: queue an engagement re-evaluation for this email. Engagement
// scoring is async and must NEVER block or break the tracking hot path — so this
// is not awaited and its errors are swallowed (logged only).
function enqueueEngagement(trackedEmailId) {
  Promise.resolve()
    .then(() => enqueueJob(trackedEmailId))
    .catch((err) => console.error(`[track] engagement enqueue failed: ${err.message}`));
}


// ─── Writes at send time ─────────────────────────────────────────────

// Create the tracked-email row (at send). Returns its id.
async function createTrackedEmail({
  replyId = null,
  recipientEmail,
  token,
  messageId = null,
  subject = null,
}) {
  const [res] = await pool.query(
    `INSERT INTO tracked_emails (reply_id, recipient_email, tracking_token, message_id, subject)
     VALUES (?, ?, ?, ?, ?)`,
    [replyId, recipientEmail, token, messageId, subject]
  );
  return res.insertId;
}

// Store the real destination of each rewritten link (redirect targets come from here).
async function addTrackedLinks(trackedEmailId, links = []) {
  if (!links.length) return;
  const values = links.map((l) => [trackedEmailId, l.linkId, l.url]);
  await pool.query(
    `INSERT INTO tracked_links (tracked_email_id, link_id, url) VALUES ?`,
    [values]
  );
}

async function markSent(trackedEmailId) {
  await pool.query(
    `UPDATE tracked_emails SET sent_at = NOW(), delivery_status = 'sent' WHERE id = ?`,
    [trackedEmailId]
  );
}

async function markFailed(trackedEmailId) {
  await pool.query(
    `UPDATE tracked_emails SET delivery_status = 'failed' WHERE id = ?`,
    [trackedEmailId]
  );
}

// ─── Writes when a recipient interacts (called by the public endpoints) ──

async function recordOpen(token, client = {}) {
  const [rows] = await pool.query(
    `SELECT id, TIMESTAMPDIFF(SECOND, sent_at, NOW()) AS secs_since_sent
       FROM tracked_emails WHERE tracking_token = ? LIMIT 1`, [token]);
  if (!rows.length) return false;
  const id = rows[0].id;
  const e = enrichClient(client);
  const source = classifyEvent({
    eventType: "open", ip: client.ip, userAgent: client.userAgent,
    secondsSinceSent: rows[0].secs_since_sent,
  });

  await pool.query(
    `INSERT INTO email_events
       (tracked_email_id, event_type, source, ip_address, user_agent, device_type, browser, email_client, country, city)
     VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, source, client.ip || null, client.userAgent || null, e.deviceType, e.browser, e.emailClient, e.country, e.city]);

  // Only real opens count: proxy = Gmail's genuine open signal; bot = prefetch/scanner.
  if (source !== "bot") {
    await pool.query(
      `UPDATE tracked_emails
          SET open_count = open_count + 1,
              first_opened_at = COALESCE(first_opened_at, NOW()),
              last_opened_at = NOW()
        WHERE id = ?`, [id]);
  }

  enqueueEngagement(id);
  return true;
}


async function recordClick(token, linkId, client = {}) {
  const [rows] = await pool.query(
    `SELECT id FROM tracked_emails WHERE tracking_token = ? LIMIT 1`, [token]);
  if (!rows.length) return null;
  const id = rows[0].id;

  const [links] = await pool.query(
    `SELECT url FROM tracked_links WHERE tracked_email_id = ? AND link_id = ? LIMIT 1`, [id, linkId]);
  if (!links.length) return null;
  const url = links[0].url;
  const e = enrichClient(client);
  const source = classifyEvent({ eventType: "click", ip: client.ip, userAgent: client.userAgent });

  await pool.query(
    `INSERT INTO email_events
       (tracked_email_id, event_type, source, link_id, link_url, ip_address, user_agent, device_type, browser, email_client, country, city)
     VALUES (?, 'click', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, source, linkId, url, client.ip || null, client.userAgent || null, e.deviceType, e.browser, e.emailClient, e.country, e.city]);

  // Only human clicks count — datacenter/scanner link-checks never bump the counter.
  if (source === "human") {
    await pool.query(
      `UPDATE tracked_emails
          SET click_count = click_count + 1,
              first_clicked_at = COALESCE(first_clicked_at, NOW()),
              last_clicked_at = NOW()
        WHERE id = ?`, [id]);
  }

  enqueueEngagement(id);
  return url;
}


async function recordUnsubscribe(token, client = {}) {
  const [rows] = await pool.query(
    `SELECT id, recipient_email FROM tracked_emails WHERE tracking_token = ? LIMIT 1`, [token]);
  if (!rows.length) return null;
  const { id, recipient_email } = rows[0];
  const e = enrichClient(client);
  const source = classifyEvent({ eventType: "unsubscribe", ip: client.ip, userAgent: client.userAgent });

  await pool.query(
    `UPDATE tracked_emails SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()) WHERE id = ?`, [id]);
  await pool.query(
    `INSERT INTO email_events
       (tracked_email_id, event_type, source, ip_address, user_agent, device_type, browser, email_client, country, city)
     VALUES (?, 'unsubscribe', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, source, client.ip || null, client.userAgent || null, e.deviceType, e.browser, e.emailClient, e.country, e.city]);
  await pool.query(
    `INSERT IGNORE INTO suppressed_recipients (email, reason) VALUES (?, 'unsubscribed')`,
    [recipient_email]);

  enqueueEngagement(id);
  return recipient_email;
}



// ─── Reads ───────────────────────────────────────────────────────────

async function isSuppressed(email) {
  const [rows] = await pool.query(
    `SELECT 1 FROM suppressed_recipients WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows.length > 0;
}


// Mark the most-recent sent email to this recipient as bounced, log the event,
// and auto-add the address to the suppression list. Returns true if matched.
async function recordBounce(recipientEmail) {
  const [rows] = await pool.query(
    `SELECT id FROM tracked_emails
       WHERE recipient_email = ? AND delivery_status = 'sent'
       ORDER BY id DESC LIMIT 1`,
    [recipientEmail]
  );
  if (!rows.length) return false;
  const id = rows[0].id;

  await pool.query(
    `UPDATE tracked_emails SET delivery_status = 'bounced', bounced_at = NOW() WHERE id = ?`,
    [id]
  );
  await pool.query(
    `INSERT INTO email_events (tracked_email_id, event_type) VALUES (?, 'bounce')`,
    [id]
  );
  await pool.query(
    `INSERT IGNORE INTO suppressed_recipients (email, reason) VALUES (?, 'bounced')`,
    [recipientEmail]
  );
  return true;
}



module.exports = {
  createTrackedEmail,
  addTrackedLinks,
  markSent,
  markFailed,
  recordOpen,
  recordClick,
  recordUnsubscribe,
  isSuppressed,
  recordBounce
};
