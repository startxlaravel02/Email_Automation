require("dotenv").config();
const crypto = require("crypto");
const { pool } = require("./src/config/db");
const m = require("./src/models/tracking.model");

(async () => {
  const token = crypto.randomBytes(16).toString("hex");
  const id = await m.createTrackedEmail({
    recipientEmail: "test@example.com",
    token,
    messageId: `<${token}@localhost>`,
    subject: "Tracking model test",
  });
  await m.addTrackedLinks(id, [
    { linkId: "l1", url: "https://startxdigital.com/get-in-touch" },
    { linkId: "l2", url: "https://startxdigital.com" },
  ]);
  await m.markSent(id);

  await m.recordOpen(token, { ip: "1.2.3.4", userAgent: "TestClient/1.0" });
  await m.recordOpen(token, { ip: "1.2.3.4", userAgent: "TestClient/1.0" });
  const dest = await m.recordClick(token, "l1", { ip: "1.2.3.4", userAgent: "TestClient/1.0" });
  const email = await m.recordUnsubscribe(token);

  console.log("click redirected to :", dest, "(expect the get-in-touch URL)");
  console.log("unsubscribed        :", email, "| isSuppressed:", await m.isSuppressed(email));

  const [[row]] = await pool.query(
    `SELECT open_count, first_opened_at, last_opened_at, click_count,
            unsubscribed_at, sent_at, delivery_status
       FROM tracked_emails WHERE id = ?`, [id]);
  console.log("summary row         :", row, "(expect open_count 2, click_count 1)");

  const [[cnt]] = await pool.query(
    `SELECT COUNT(*) AS events FROM email_events WHERE tracked_email_id = ?`, [id]);
  console.log("event rows          :", cnt.events, "(expect 4)");

  // cleanup (cascade removes links + events)
  await pool.query("DELETE FROM tracked_emails WHERE id = ?", [id]);
  await pool.query("DELETE FROM suppressed_recipients WHERE email = ?", ["test@example.com"]);
  console.log("cleanup done");
  await pool.end();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
