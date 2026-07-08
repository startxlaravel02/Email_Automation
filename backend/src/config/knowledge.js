const fs = require("fs");
const path = require("path");

// The company knowledge base — facts the AI answers from (services, pricing,
// process, documents, links). Editable as plain markdown by anyone; loaded once
// at startup. If it's missing, we fall back to empty so the app still runs (the
// AI just won't have facts to give).
const KB_PATH = path.join(__dirname, "../../knowledge/company.md");

let knowledgeText = "";
try {
  knowledgeText = fs.readFileSync(KB_PATH, "utf8").trim();
} catch (err) {
  console.warn(`[knowledge] could not load company.md: ${err.message}`);
}

const COMPANY_NAME = process.env.COMPANY_NAME || "StartX Digital";
const WEBSITE = process.env.COMPANY_WEBSITE || "https://startxdigital.com";

// One consistent sign-off applied to every reply.
const signature = `Best regards,
${COMPANY_NAME} Team
${WEBSITE}`;

module.exports = { knowledgeText, signature, COMPANY_NAME, WEBSITE };
