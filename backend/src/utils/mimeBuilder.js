// Builds a raw RFC 2822 message (base64url-encoded) for the Gmail API's
// drafts.create / messages.send. Kept pure so it's easy to unit-test.
//
// Notes:
//   - We omit the From header; Gmail fills it with the authenticated account.
//   - In-Reply-To + References tie the reply to the original message so Gmail
//     threads it under the same conversation.
const buildRawReply = ({ to, subject = "", body = "", inReplyTo }) => {
  const replySubject = /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;

  const headers = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }

  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;

  return Buffer.from(message, "utf8").toString("base64url");
};

// base64-encode a string, wrapped at 76 cols (RFC 2045) — safe for unicode + long HTML.
const _b64 = (s) =>
  (Buffer.from(String(s), "utf8").toString("base64").match(/.{1,76}/g) || []).join("\r\n");

// A multipart/alternative reply: text/plain fallback + text/html (tracked) part.
// Sets Message-ID (for later bounce matching) and keeps threading headers.
const buildRawMultipartReply = ({ to, subject = "", text = "", html = "", inReplyTo, messageId }) => {
  const replySubject = /^re:/i.test(String(subject).trim()) ? subject : `Re: ${subject}`;
  const boundary = "alt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const headers = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (messageId) headers.push(`Message-ID: ${messageId}`);
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    _b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    _b64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const message = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(message, "utf8").toString("base64url");
};


module.exports = { buildRawReply , buildRawMultipartReply };
