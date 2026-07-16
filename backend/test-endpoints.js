require("dotenv").config();
const { pool } = require("./src/config/db");
const m = require("./src/models/tracking.model");

(async () => {
  const token = "ENDPOINTTEST";
  await pool.query("DELETE FROM tracked_emails WHERE tracking_token = ?", [token]); // clean any prior
  const id = await m.createTrackedEmail({ recipientEmail: "endpoint@example.com", token, subject: "Endpoint test" });
  await m.addTrackedLinks(id, [{ linkId: "l1", url: "https://startxdigital.com/get-in-touch" }]);
  await m.markSent(id);
  console.log(`Seeded tracked_email id=${id}, token=${token}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
