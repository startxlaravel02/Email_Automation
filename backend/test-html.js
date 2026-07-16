require("dotenv").config();
const { buildTrackedHtml } = require("./src/utils/htmlEmail");

const token = "TESTTOKEN123";
const sample =
  "Dear John,\n\nThanks for reaching out. You can start here: " +
  "https://startxdigital.com/get-in-touch\n\nBest,\nStartX Digital Team";

const out = buildTrackedHtml(sample, token);
console.log("LINKS:", out.links);
console.log("\nHTML:\n" + out.html);
console.log("\nchecks:");
console.log("  pixel present     :", out.html.includes(`/track/open/${token}.gif`));
console.log("  click rewrite (l1):", out.html.includes(`/track/click/${token}/l1`));
console.log("  unsubscribe link  :", out.html.includes(`/track/unsubscribe/${token}`));
console.log("  raw URL NOT bare  :", !out.html.includes('href="https://startxdigital.com/get-in-touch"'));
