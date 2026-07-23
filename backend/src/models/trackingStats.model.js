const { pool } = require("../config/db");

// Build a safe date-range WHERE fragment for a datetime column.
// from/to are 'YYYY-MM-DD' strings (format-validated); values are parameterized.
// Returns { clause, params } — clause is always safe to AND into a WHERE.
function dateRange(column, from, to) {
  const clauses = [];
  const params = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    clauses.push(`${column} >= ?`);
    params.push(`${from} 00:00:00`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    clauses.push(`${column} <= ?`);
    params.push(`${to} 23:59:59`);
  }
  return { clause: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

// Headline totals + rates (optionally scoped to a sent_at date range).
async function getOverview({ from, to } = {}) {
  const { clause, params } = dateRange("sent_at", from, to);
  const [[r]] = await pool.query(
    `SELECT
       COUNT(*)                                       AS total_sent,
       COALESCE(SUM(open_count > 0), 0)               AS opened_emails,
       COALESCE(SUM(click_count > 0), 0)              AS clicked_emails,
       COALESCE(SUM(open_count), 0)                   AS total_opens,
       COALESCE(SUM(click_count), 0)                  AS total_clicks,
       COALESCE(SUM(delivery_status = 'bounced'), 0)  AS bounced,
       COALESCE(SUM(unsubscribed_at IS NOT NULL), 0)  AS unsubscribed,
       COALESCE(SUM(spam_complaint_at IS NOT NULL), 0) AS spam_complaints
     FROM tracked_emails WHERE ${clause}`,
    params
  );
  const total = Number(r.total_sent) || 0;
  const rate = (n) => (total ? +((Number(n) / total) * 100).toFixed(1) : 0);
  return {
    totalSent: total,
    openedEmails: Number(r.opened_emails),
    clickedEmails: Number(r.clicked_emails),
    totalOpens: Number(r.total_opens),
    totalClicks: Number(r.total_clicks),
    bounced: Number(r.bounced),
    unsubscribed: Number(r.unsubscribed),
    spamComplaints: Number(r.spam_complaints),
    rates: {
      open: rate(r.opened_emails),
      click: rate(r.clicked_emails),
      bounce: rate(r.bounced),
      unsubscribe: rate(r.unsubscribed),
      spam: rate(r.spam_complaints),
    },
  };
}

// Device / browser / email-client / country breakdowns (column whitelisted; dates scoped).
const BREAKDOWN_COLUMNS = {
  device: "device_type",
  browser: "browser",
  client: "email_client",
  country: "country",
};
async function getBreakdown(kind, { from, to } = {}) {
  const col = BREAKDOWN_COLUMNS[kind];
  if (!col) return [];
  const { clause, params } = dateRange("created_at", from, to);
  const [rows] = await pool.query(
    `SELECT ${col} AS label, COUNT(*) AS count
       FROM email_events
      WHERE ${col} IS NOT NULL AND ${col} <> '' AND source = 'human' AND ${clause}
      GROUP BY ${col} ORDER BY count DESC LIMIT 20`,
    params
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.count) }));
}

async function getMostClickedLinks(limit = 10, { from, to } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const { clause, params } = dateRange("created_at", from, to);
  const [rows] = await pool.query(
    `SELECT link_url AS url, COUNT(*) AS clicks, COUNT(DISTINCT tracked_email_id) AS uniq
       FROM email_events
      WHERE event_type = 'click' AND source = 'human' AND link_url IS NOT NULL AND ${clause}
      GROUP BY link_url ORDER BY clicks DESC LIMIT ${lim}`,
    params
  );
  return rows.map((r) => ({ url: r.url, clicks: Number(r.clicks), uniq: Number(r.uniq) }));
}

async function getRecentActivity(limit = 50, { from, to } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const { clause, params } = dateRange("ev.created_at", from, to);
  const [rows] = await pool.query(
    `SELECT ev.event_type, ev.source, ev.created_at, ev.device_type, ev.browser, ev.country, ev.link_url,
            te.recipient_email, te.subject
       FROM email_events ev
       JOIN tracked_emails te ON te.id = ev.tracked_email_id
      WHERE ev.source <> 'bot' AND ${clause}
      ORDER BY ev.id DESC LIMIT ${lim}`,
    params
  );
  return rows;
}

async function getEngagementTrend(days = 14, { from, to } = {}) {
  let clause, params;
  if (from || to) {
    const r = dateRange("created_at", from, to);
    clause = `event_type IN ('open','click') AND source <> 'bot' AND ${r.clause}`;
    params = r.params;
  } else {
    const d = Math.min(Math.max(parseInt(days, 10) || 14, 1), 90);
    clause = `event_type IN ('open','click') AND source <> 'bot' AND created_at >= (CURDATE() - INTERVAL ${d} DAY)`;
    params = [];
  }
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS day, event_type, COUNT(*) AS count
       FROM email_events WHERE ${clause}
      GROUP BY day, event_type ORDER BY day`,
    params
  );
  return rows.map((r) => ({ day: r.day, eventType: r.event_type, count: Number(r.count) }));
}

// Clicks bucketed by day-of-week (1=Sun .. 7=Sat) and hour (0..23); dates scoped.
async function getClickHeatmap({ from, to } = {}) {
  const { clause, params } = dateRange("created_at", from, to);
  const [rows] = await pool.query(
    `SELECT DAYOFWEEK(created_at) AS dow, HOUR(created_at) AS hour, COUNT(*) AS count
       FROM email_events WHERE event_type = 'click' AND source = 'human' AND ${clause}
       GROUP BY dow, hour`,
    params
  );
  return rows.map((r) => ({ dow: Number(r.dow), hour: Number(r.hour), count: Number(r.count) }));
}

// Search recipients (empty q = most recent), with per-recipient rollups.
async function searchRecipients(q = "", limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const like = `%${String(q).trim()}%`;
  const [rows] = await pool.query(
    `SELECT recipient_email,
            COUNT(*)                       AS emails,
            COALESCE(SUM(open_count), 0)   AS opens,
            COALESCE(SUM(click_count), 0)  AS clicks,
            MAX(COALESCE(last_clicked_at, last_opened_at, sent_at, created_at)) AS last_activity,
            MAX(delivery_status = 'bounced') AS has_bounce
       FROM tracked_emails
      WHERE recipient_email LIKE ?
      GROUP BY recipient_email
      ORDER BY last_activity DESC
      LIMIT ${lim}`,
    [like]
  );
  return rows.map((r) => ({
    email: r.recipient_email,
    emails: Number(r.emails),
    opens: Number(r.opens),
    clicks: Number(r.clicks),
    lastActivity: r.last_activity,
    bounced: !!Number(r.has_bounce),
  }));
}

// Full history for one recipient: each email (with first/last open+click) + a timeline.
async function getRecipientDetail(email) {
  const [emails] = await pool.query(
    `SELECT te.id, te.subject, te.sent_at, te.delivery_status,
            te.open_count, te.first_opened_at, te.last_opened_at,
            te.click_count, te.first_clicked_at, te.last_clicked_at,
            e.thread_id,
            ee.engagement_level, ee.engagement_stage
       FROM tracked_emails te
       LEFT JOIN replies r ON r.id = te.reply_id
       LEFT JOIN emails e  ON e.id = r.email_id
       LEFT JOIN email_engagement ee ON ee.tracked_email_id = te.id
      WHERE te.recipient_email = ? ORDER BY te.id DESC`,
    [email]
  );
  // Links this recipient actually clicked (human/proxy, never bot), with counts.
  const [links] = await pool.query(
    `SELECT ev.link_url AS url, COUNT(*) AS clicks
       FROM email_events ev
       JOIN tracked_emails te ON te.id = ev.tracked_email_id
      WHERE te.recipient_email = ? AND ev.event_type = 'click'
        AND ev.link_url IS NOT NULL AND ev.source <> 'bot'
      GROUP BY ev.link_url ORDER BY clicks DESC LIMIT 50`,
    [email]
  );
  const [timeline] = await pool.query(
    `SELECT ev.event_type, ev.source, ev.link_url, ev.device_type, ev.browser, ev.country, ev.created_at, te.subject
       FROM email_events ev
       JOIN tracked_emails te ON te.id = ev.tracked_email_id
      WHERE te.recipient_email = ? AND ev.source <> 'bot' ORDER BY ev.id DESC LIMIT 200`,
    [email]
  );
  const [supp] = await pool.query(
    `SELECT reason FROM suppressed_recipients WHERE email = ? LIMIT 1`,
    [email]
  );
  return { email, suppressed: supp.length ? supp[0].reason : null, emails, timeline, links };
}

async function getExportRows(limit = 5000, { from, to } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 50000);
  const { clause, params } = dateRange("sent_at", from, to);
  const [rows] = await pool.query(
    `SELECT recipient_email, subject, sent_at, delivery_status,
            open_count, first_opened_at, last_opened_at,
            click_count, first_clicked_at, last_clicked_at,
            bounced_at, unsubscribed_at
       FROM tracked_emails WHERE ${clause} ORDER BY id DESC LIMIT ${lim}`,
    params
  );
  return rows;
}

// Tracking status of every sent (tracked) email on a given thread — open/click
// counts + delivery status. Powers the "tracking" panel on the conversation page.
async function getThreadTracking(threadId) {
  const [rows] = await pool.query(
    `SELECT te.id, te.subject, te.sent_at, te.delivery_status,
            te.open_count, te.first_opened_at, te.last_opened_at,
            te.click_count, te.first_clicked_at, te.last_clicked_at,
            te.recipient_email,
            ee.engagement_level, ee.engagement_stage
       FROM tracked_emails te
       JOIN replies r ON r.id = te.reply_id
       JOIN emails e  ON e.id = r.email_id
       LEFT JOIN email_engagement ee ON ee.tracked_email_id = te.id
      WHERE e.thread_id = ? ORDER BY te.id ASC`,
    [threadId]
  );
  return rows;
}

// Links clicked on a given thread (human/proxy, never bot), with counts.
async function getThreadLinks(threadId) {
  const [rows] = await pool.query(
    `SELECT ev.link_url AS url, COUNT(*) AS clicks
       FROM email_events ev
       JOIN tracked_emails te ON te.id = ev.tracked_email_id
       JOIN replies r ON r.id = te.reply_id
       JOIN emails e  ON e.id = r.email_id
      WHERE e.thread_id = ? AND ev.event_type = 'click'
        AND ev.link_url IS NOT NULL AND ev.source <> 'bot'
      GROUP BY ev.link_url ORDER BY clicks DESC`,
    [threadId]
  );
  return rows;
}

module.exports = {
  getOverview,
  getBreakdown,
  getThreadTracking,
  getThreadLinks,
  getMostClickedLinks,
  getRecentActivity,
  getEngagementTrend,
  getClickHeatmap,
  searchRecipients,
  getRecipientDetail,
  getExportRows,
};
