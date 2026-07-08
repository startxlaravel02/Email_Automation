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

module.exports = { buildRawReply };
