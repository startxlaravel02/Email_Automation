const { google } = require("googleapis");
const authorize = require("./gmailAuth");
const { parseEmail } = require("../utils/emailParser");
const { buildRawReply } = require("../utils/mimeBuilder");

// One authenticated Gmail client, reused by every operation below.
async function getGmailClient() {
  const auth = await authorize();
  return google.gmail({ version: "v1", auth });
}

// Extract the bare address from a "Name <addr@x.com>" header, lowercased.
const emailAddr = (from = "") =>
  (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();

// The connected account's own email address (cached) — used to tell which
// messages in a thread are "us" vs the customer.
let cachedAddress = null;
async function getMyAddress() {
  if (cachedAddress) return cachedAddress;
  const gmail = await getGmailClient();
  const { data } = await gmail.users.getProfile({ userId: "me" });
  cachedAddress = (data.emailAddress || "").toLowerCase();
  return cachedAddress;
}

// List recent emails as lean items (no heavy html body / internal signals).
async function listEmails() {
  const gmail = await getGmailClient();

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 5,
  });

  const messages = res.data.messages || [];

  const emails = [];

  for (const message of messages) {
    const fullEmail = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full",
    });

    // Drop the heavy html body and internal filtering signals from list output.
    const { html, listUnsubscribe, precedence, autoSubmitted, ...listItem } =
      parseEmail(fullEmail.data);
    emails.push(listItem);
  }

  return emails;
}

// Fetch a single email, fully parsed (includes html) — e.g. to reply to it.
async function getEmail(id) {
  const gmail = await getGmailClient();

  const fullEmail = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });

  return parseEmail(fullEmail.data);
}

// Fetch a whole conversation as an ordered list (oldest first), each message
// parsed and tagged as ours or the customer's — powers context-aware replies.
async function getThread(threadId) {
  const gmail = await getGmailClient();
  const myAddress = await getMyAddress();

  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  return (res.data.messages || []).map((m) => {
    const parsed = parseEmail(m);
    return {
      from: parsed.from,
      date: parsed.date,
      text: parsed.text,
      isFromUs: emailAddr(parsed.from) === myAddress,
    };
  });
}

// Save a reply as a Gmail Draft on the original thread (never sends).
// `gmail.modify` scope covers drafts, so no re-consent is needed.
async function createDraftReply({ to, subject, body, threadId, inReplyTo }) {
  const gmail = await getGmailClient();

  const raw = buildRawReply({ to, subject, body, inReplyTo });

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { threadId, raw },
    },
  });

  return res.data; // { id, message: { id, threadId } }
}

// Send a reply immediately on the original thread (Phase 4 — auto-send).
// `gmail.modify` scope also covers messages.send, so no re-consent is needed.
async function sendReply({ to, subject, body, threadId, inReplyTo }) {
  const gmail = await getGmailClient();

  const raw = buildRawReply({ to, subject, body, inReplyTo });

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { threadId, raw },
  });

  return res.data; // { id, threadId, labelIds }
}

// --- Polling / auto-reply helpers (Phase 5a) ---

// Message ids that are unread, in the inbox, and not yet tagged with ANY of the
// given labels (our dedupe markers). Label names are quoted so multi-word ones
// like "Action Required" match correctly.
async function listUnprocessedMessages(excludeLabels, maxResults) {
  const gmail = await getGmailClient();

  const exclusions = excludeLabels.map((name) => `-label:"${name}"`).join(" ");

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: `in:inbox is:unread ${exclusions}`.trim(),
  });

  return res.data.messages || [];
}

// Find (or create once) a label by name and return its id. Cached PER NAME so
// multiple labels (AI-Processed, Action Required) don't overwrite each other.
const labelCache = {};
async function getOrCreateLabelId(labelName) {
  if (labelCache[labelName]) return labelCache[labelName];

  const gmail = await getGmailClient();

  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = (data.labels || []).find((l) => l.name === labelName);

  if (existing) {
    labelCache[labelName] = existing.id;
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  labelCache[labelName] = created.data.id;
  return created.data.id;
}

// Tag a message with a label — our dedupe marker.
async function addLabel(messageId, labelId) {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}

module.exports = {
  listEmails,
  getEmail,
  getThread,
  createDraftReply,
  sendReply,
  listUnprocessedMessages,
  getOrCreateLabelId,
  addLabel,
};
