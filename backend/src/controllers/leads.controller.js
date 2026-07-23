const { getLeads, getLeadsForExport } = require("../models/trademarkLead.model");

// GET /api/leads?page=1&pageSize=25&from=YYYY-MM-DD&to=YYYY-MM-DD
const listLeads = async (req, res) => {
  try {
    const { page, pageSize, from, to, count } = req.query;
    const data = await getLeads({
      page, pageSize, from: from || null, to: to || null,
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
    const { from, to, fields } = req.query;
    const requested = (fields || "").split(",").map((s) => s.trim()).filter(Boolean);
    const { columns, rows } = await getLeadsForExport({
      from: from || null,
      to: to || null,
      columns: requested,
    });
    const csv = [
      columns.join(","),
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

module.exports = { listLeads, exportLeads };
