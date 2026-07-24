/**
 * src/models/trademarkLead.model.js
 *
 * Thin model layer for trademark_leads, matching the project's existing
 * mysql2-pool + model-file convention (see email.model.js / tracking.model.js).
 */

const { pool } = require("../config/db"); // adjust path/name if your pool export differs

const UPSERT_SQL = `
  INSERT INTO trademark_leads
    (serial_number, registration_number, mark_text, owner_name, owner_address,
     status_code, filing_date, registration_date, registration_expiration_date,
     abandonment_date, cancellation_date, renewal_date, computed_deadline_date,
     deadline_type, is_dead, attorney_name, source)
  VALUES ?
  ON DUPLICATE KEY UPDATE
    registration_number          = VALUES(registration_number),
    mark_text                    = VALUES(mark_text),
    owner_name                   = VALUES(owner_name),
    owner_address                = VALUES(owner_address),
    status_code                  = VALUES(status_code),
    filing_date                  = VALUES(filing_date),
    registration_date            = VALUES(registration_date),
    registration_expiration_date = VALUES(registration_expiration_date),
    abandonment_date             = VALUES(abandonment_date),
    cancellation_date            = VALUES(cancellation_date),
    renewal_date                 = VALUES(renewal_date),
    computed_deadline_date       = VALUES(computed_deadline_date),
    deadline_type                = VALUES(deadline_type),
    is_dead                      = VALUES(is_dead),
    attorney_name                = VALUES(attorney_name)
`;

/**
 * Bulk upsert a batch of parsed bulk-XML records.
 * @param {object[]} records - as produced by bulkXmlParser.parseBulkFile
 * @param {'annual_seed'|'daily_sync'} source
 */
async function upsertBatch(records, source = 'annual_seed') {
  if (!records.length) return { affectedRows: 0 };

  const values = records.map((r) => [
    r.serial_number,
    r.registration_number,
    r.mark_text,
    r.owner_name,
    r.owner_address,
    r.status_code,
    r.filing_date,
    r.registration_date,
    r.registration_expiration_date,
    r.abandonment_date,
    r.cancellation_date,
    r.renewal_date,
    r.computed_deadline_date,
    r.deadline_type,
    r.is_dead,
    r.attorney_name,
    source,
  ]);

  const [result] = await pool.query(UPSERT_SQL, [values]);
  return result;
}

/**
 * Candidates for TSDR verification: near-deadline, not yet sent, not
 * re-checked in the last day (so re-runs don't hammer already-fresh rows).
 */
async function getVerificationCandidates({ windowMinDays = 0, windowDays = 45, limit = 200 } = {}) {
  // windowMinDays sets a LOWER bound so we don't waste TSDR calls on marks whose
  // deadline is already upon them (those are usually lapsed/cancelled and too late
  // to pitch). is_dead=0 skips marks the bulk data already knows are dead.
  const [rows] = await pool.query(
    `SELECT id, serial_number FROM trademark_leads
     WHERE is_dead = 0
       AND computed_deadline_date BETWEEN (CURDATE() + INTERVAL ? DAY) AND (CURDATE() + INTERVAL ? DAY)
       AND email_sent_at IS NULL
       AND (attorney_confirmed_at IS NULL OR attorney_confirmed_at < (NOW() - INTERVAL 1 DAY))
     ORDER BY computed_deadline_date ASC
     LIMIT ?`,
    [windowMinDays, windowDays, limit]
  );
  return rows;
}

async function updateAfterTsdrVerify(serialNumber, { attorney_name, owner_email, status_text }) {
  // NOTE: "is_dead" (derived from status_text containing abandon/cancel) is
  // NOT written into lead_status here — 'opted_out' specifically means the
  // recipient unsubscribed, which is a different thing entirely from a mark
  // being dead/cancelled. Dead marks are excluded via status_text filtering
  // in getQualifiedLeads() below instead.
  await pool.query(
    `UPDATE trademark_leads
     SET attorney_name = ?, owner_email = ?, status_text = ?,
         attorney_confirmed_at = NOW(),
         lead_status = 'verified'
     WHERE serial_number = ?`,
    [attorney_name || null, owner_email || null, status_text || null, serialNumber]
  );
}

async function getQualifiedLeads({ limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT * FROM trademark_leads
     WHERE (attorney_name IS NULL OR attorney_name = '')
       AND owner_email IS NOT NULL AND owner_email <> ''
       AND email_sent_at IS NULL
       AND lead_status <> 'opted_out'
       AND (status_text IS NULL OR status_text NOT REGEXP 'abandon|cancel')
     ORDER BY computed_deadline_date ASC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

// Columns that may be exported/selected (allowlist — used to build SQL safely).
const EXPORT_COLUMNS = [
  "serial_number", "registration_number", "mark_text", "owner_name", "owner_address",
  "owner_email", "status_code", "status_text", "filing_date", "registration_date",
  "registration_expiration_date", "abandonment_date", "cancellation_date", "renewal_date",
  "computed_deadline_date", "deadline_type", "is_dead", "attorney_name",
  "attorney_confirmed_at", "lead_status", "source", "email_sent_at", "created_at", "updated_at",
];
const DEFAULT_EXPORT_COLUMNS = [
  "serial_number", "registration_number", "owner_email", "owner_name", "owner_address", "mark_text",
];

// Shared WHERE for the leads list/export. A "lead" = a VERIFIED row (fast: uses
// idx_lead_status) with NO attorney and an owner email. Optional deadline range.
function leadsWhere({ from, to, q }) {
  const where = [
    "lead_status = 'verified'",
    "(attorney_name IS NULL OR attorney_name = '')",
    "owner_email IS NOT NULL AND owner_email <> ''",
    "(status_text IS NULL OR status_text NOT REGEXP 'abandon|cancel')", // skip dead marks (matches qualified_leads view)
  ];
  const params = [];
  if (from) { where.push("computed_deadline_date >= ?"); params.push(from); }
  if (to) { where.push("computed_deadline_date <= ?"); params.push(to); }
  // Free-text search across the visible on-screen attributes.
  if (q) {
    where.push("(owner_name LIKE ? OR owner_email LIKE ? OR mark_text LIKE ? OR serial_number LIKE ? OR registration_number LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  return { clause: where.join(" AND "), params };
}

// Paginated leads. The COUNT is the expensive part on a 14M-row table, so it's
// only run when withCount=true (filter changes) — page navigation reuses it.
async function getLeads({ page = 1, pageSize = 25, from = null, to = null, q = null, withCount = true } = {}) {
  const ps = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 200);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pg - 1) * ps;
  const { clause, params } = leadsWhere({ from, to, q });

  let total = null;
  if (withCount) {
    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM trademark_leads WHERE ${clause}`, params);
    total = cnt.total;
  }
  const [rows] = await pool.query(
    `SELECT id, serial_number, registration_number, mark_text, owner_name, owner_email,
            attorney_name, computed_deadline_date, deadline_type, status_text, lead_status
       FROM trademark_leads WHERE ${clause}
      ORDER BY computed_deadline_date ASC, id ASC
      LIMIT ${ps} OFFSET ${offset}`,
    params
  );
  return { rows, total, page: pg, pageSize: ps };
}

// Just the total count (the slow part). Fetched on its own so the row list
// never waits for it — see the leads controller/route.
async function getLeadsCount({ from = null, to = null, q = null } = {}) {
  const { clause, params } = leadsWhere({ from, to, q });
  const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM trademark_leads WHERE ${clause}`, params);
  return cnt.total;
}

// Rows for CSV export (bounded), with a CALLER-CHOSEN column set. Columns are
// validated against the allowlist so they're safe to interpolate into SQL.
async function getLeadsForExport({ from = null, to = null, columns = null, limit = 50000 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50000, 1), 100000);
  const picked = (Array.isArray(columns) ? columns : []).filter((c) => EXPORT_COLUMNS.includes(c));
  const cols = picked.length ? picked : DEFAULT_EXPORT_COLUMNS;
  const { clause, params } = leadsWhere({ from, to });
  const [rows] = await pool.query(
    `SELECT ${cols.join(", ")}
       FROM trademark_leads WHERE ${clause}
      ORDER BY computed_deadline_date ASC LIMIT ${lim}`,
    params
  );
  return { columns: cols, rows };
}

module.exports = {
  upsertBatch,
  getVerificationCandidates,
  updateAfterTsdrVerify,
  getQualifiedLeads,
  getLeads,
  getLeadsCount,
  getLeadsForExport,
};