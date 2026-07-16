const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { getExportRows, getOverview } = require("../models/trackingStats.model");

// [Header label, DB column]
const COLUMNS = [
  ["Recipient", "recipient_email"], ["Subject", "subject"], ["Sent", "sent_at"],
  ["Status", "delivery_status"], ["Opens", "open_count"], ["First open", "first_opened_at"],
  ["Last open", "last_opened_at"], ["Clicks", "click_count"], ["First click", "first_clicked_at"],
  ["Last click", "last_clicked_at"], ["Bounced", "bounced_at"], ["Unsubscribed", "unsubscribed_at"],
];
const val = (v) =>
  v == null ? "" : v instanceof Date ? v.toISOString().replace("T", " ").slice(0, 19) : String(v);

// GET /api/analytics/export?format=csv|xlsx|pdf
async function exportReport(req, res) {
  const format = (req.query.format || "csv").toLowerCase();
  const range = { from: req.query.from, to: req.query.to };
  try {
    const rows = await getExportRows(5000, range);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
      const head = COLUMNS.map((c) => esc(c[0])).join(",");
      const body = rows.map((r) => COLUMNS.map((c) => esc(val(r[c[1]]))).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tracking-report-${stamp}.csv"`);
      return res.send(head + "\n" + body);
    }

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Tracking");
      ws.columns = COLUMNS.map((c) => ({ header: c[0], key: c[1], width: 22 }));
      rows.forEach((r) => {
        const o = {};
        COLUMNS.forEach((c) => (o[c[1]] = val(r[c[1]])));
        ws.addRow(o);
      });
      ws.getRow(1).font = { bold: true };
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="tracking-report-${stamp}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    if (format === "pdf") {
      const ov = await getOverview(range);
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="tracking-report-${stamp}.pdf"`);
      doc.pipe(res);
      doc.fontSize(18).fillColor("#111").text("Email Tracking Report");
      doc.fontSize(10).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`);
      doc.moveDown();
      doc.fontSize(12).fillColor("#111").text("Summary");
      doc.fontSize(10).fillColor("#333").text(
        `Sent: ${ov.totalSent}    Open rate: ${ov.rates.open}%    Click rate: ${ov.rates.click}%    ` +
        `Bounce: ${ov.rates.bounce}%    Unsubscribe: ${ov.rates.unsubscribe}%`
      );
      doc.moveDown();
      doc.fontSize(12).fillColor("#111").text("Recent emails");
      doc.moveDown(0.4).fontSize(9).fillColor("#333");
      rows.slice(0, 40).forEach((r) => {
        doc.text(`${val(r.sent_at)}  ·  ${r.recipient_email}  ·  ${r.delivery_status}  ·  opens ${r.open_count} / clicks ${r.click_count}`);
      });
      doc.end();
      return;
    }

    return res.status(400).json({ success: false, message: "format must be csv, xlsx, or pdf" });
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Export failed" });
  }
}

module.exports = { exportReport };
