const { getLeads, getLeadsCount, getLeadsForExport } = require("../models/trademarkLead.model");

// Friendly CSV headers — MUST match the checkbox labels in the frontend
// LeadsView EXPORT_FIELDS so the column names look identical in both places.
const COLUMN_LABELS = {
  serial_number: "Serial number",
  registration_number: "Registration number",
  owner_email: "Email",
  owner_name: "Owner name",
  owner_address: "Address",
  mark_text: "Trademark (mark)",
  computed_deadline_date: "Deadline date",
  deadline_type: "Deadline type",
  registration_date: "Registration date",
  registration_expiration_date: "Registration expiration",
  filing_date: "Filing date",
  renewal_date: "Renewal date",
  abandonment_date: "Abandonment date",
  cancellation_date: "Cancellation date",
  status_code: "Status code",
  status_text: "Status text",
  is_dead: "Is dead",
  attorney_name: "Attorney name",
  attorney_confirmed_at: "Attorney confirmed at",
  lead_status: "Lead status",
  source: "Source",
  email_sent_at: "Email sent at",
  created_at: "Created at",
  updated_at: "Updated at",
};

// GET /api/leads?page=1&pageSize=25&from=YYYY-MM-DD&to=YYYY-MM-DD
const listLeads = async (req, res) => {
  try {
    const { page, pageSize, from, to, q, count } = req.query;
    const data = await getLeads({
      page, pageSize, from: from || null, to: to || null, q: q || null,
      withCount: count !== "0",
    });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load leads" });
  }
};

// Format a Date compactly (YYYY-MM-DD, or with time if it isn't midnight).
// Uses LOCAL parts so a date isn't shifted a day by UTC conversion.
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (d.getHours() || d.getMinutes() || d.getSeconds()) {
    return `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return date;
}

// GET /api/leads/count?from=&to=  ->  just the total (the slow COUNT), on its own.
const countLeads = async (req, res) => {
  try {
    const { from, to, q } = req.query;
    const total = await getLeadsCount({ from: from || null, to: to || null, q: q || null });
    res.json({ success: true, total });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to count leads" });
  }
};

// Escape a value for a CSV cell (and compact any Date so date columns stay narrow).
function csvCell(v) {
  if (v == null) return "";
  if (v instanceof Date) v = fmtDate(v);
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

// GET /api/leads/export?from=&to=&fields=col1,col2  ->  CSV download.
// `fields` chooses (and orders) the columns; invalid ones are dropped, and an
// empty/invalid list falls back to the model's defaults.
const exportLeads = async (req, res) => {
  try {
    const { from, to, fields, limit } = req.query;
    const requested = (fields || "").split(",").map((s) => s.trim()).filter(Boolean);
    const { columns, rows } = await getLeadsForExport({
      from: from || null,
      to: to || null,
      columns: requested,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    const header = columns.map((c) => COLUMN_LABELS[c] || c).join(",");
    const csv = [
      header,
      ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to export leads" });
  }
};

module.exports = { listLeads, countLeads, exportLeads };
