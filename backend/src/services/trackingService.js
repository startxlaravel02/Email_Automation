const crypto = require("crypto");
const { buildTrackedHtml } = require("../utils/htmlEmail");
const { buildRawMultipartReply } = require("../utils/mimeBuilder");
const { sendRawMessage, sendReply } = require("./gmailService");
const {
  createTrackedEmail,
  addTrackedLinks,
  markSent,
  markFailed,
  isSuppressed,
} = require("../models/tracking.model");

const TRACKING_ENABLED = process.env.TRACKING_ENABLED !== "false"; // default ON
const HOST = (process.env.PUBLIC_BASE_URL || "http://localhost:5000")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, ""); // used only for the Message-ID domain

const bareEmail = (s) =>
  (String(s).match(/<([^>]+)>/)?.[1] || String(s)).trim().toLowerCase();

// Send an email WITH tracking: build HTML (pixel + rewritten links + unsubscribe),
// record it + its links, send as multipart, mark sent/failed.
// Falls back to a plain send if TRACKING_ENABLED=false.
async function sendTracked({
  to,
  subject,
  body,
  threadId = null,
  inReplyTo = null,
  replyId = null,
}) {
  if (!TRACKING_ENABLED) {
    return sendReply({ to, subject, body, threadId, inReplyTo });
  }

  const recipient = bareEmail(to);
  if (await isSuppressed(recipient)) {
    console.warn(`[tracking] recipient suppressed, not sending: ${recipient}`);
    return { suppressed: true };
  }

  const token = crypto.randomBytes(16).toString("hex");
  const messageId = `<${token}@${HOST}>`;

  const { html, text, links } = buildTrackedHtml(body, token);

  const trackedId = await createTrackedEmail({
    replyId,
    recipientEmail: recipient, // bare address so suppression matching is consistent
    token,
    messageId,
    subject,
  });
  await addTrackedLinks(trackedId, links);

  const raw = buildRawMultipartReply({
    to,
    subject,
    text,
    html,
    inReplyTo,
    messageId,
  });

  try {
    const res = await sendRawMessage({ raw, threadId });
    await markSent(trackedId);
    return res;
  } catch (err) {
    await markFailed(trackedId);
    throw err;
  }
}

module.exports = { sendTracked };
