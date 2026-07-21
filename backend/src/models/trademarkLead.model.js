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
     status_code, filing_date, registration_date, computed_deadline_date,
     deadline_type, attorney_name, source)
  VALUES ?
  ON DUPLICATE KEY UPDATE
    registration_number    = VALUES(registration_number),
    mark_text              = VALUES(mark_text),
    owner_name             = VALUES(owner_name),
    owner_address          = VALUES(owner_address),
    status_code            = VALUES(status_code),
    filing_date            = VALUES(filing_date),
    registration_date      = VALUES(registration_date),
    computed_deadline_date = VALUES(computed_deadline_date),
    deadline_type          = VALUES(deadline_type),
    attorney_name          = VALUES(attorney_name)
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
    r.computed_deadline_date,
    r.deadline_type,
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
async function getVerificationCandidates({ windowDays = 45, limit = 200 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, serial_number FROM trademark_leads
     WHERE computed_deadline_date BETWEEN CURDATE() AND (CURDATE() + INTERVAL ? DAY)
       AND email_sent_at IS NULL
       AND (attorney_confirmed_at IS NULL OR attorney_confirmed_at < (NOW() - INTERVAL 1 DAY))
     ORDER BY computed_deadline_date ASC
     LIMIT ?`,
    [windowDays, limit]
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

module.exports = {
  upsertBatch,
  getVerificationCandidates,
  updateAfterTsdrVerify,
  getQualifiedLeads,
};