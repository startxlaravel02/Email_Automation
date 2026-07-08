// Pure helpers that turn a Gmail API message resource into a clean, usable email
// object. There is no I/O here on purpose — this keeps the MIME parsing logic
// easy to unit-test and reuse (e.g. later from the Ollama/prompt layer).

// Gmail returns every part's body as a base64url string, already decoded from
// the original transfer-encoding (quoted-printable/base64). So a single
// base64url decode is all we need.
const decodeBody = (data) =>
  data ? Buffer.from(data, "base64url").toString("utf8") : "";

const getHeader = (headers = [], name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

// Collapse the whitespace noise that both real emails and our HTML stripper
// leave behind: normalize CRLF, drop trailing spaces, cap blank-line runs.
const normalizeText = (s) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Minimal HTML -> text fallback for emails that ship only an HTML part (very
// common for marketing mail). Intentionally simple — not a full renderer — but
// it strips the noise that made HTML-only mail unreadable: comments (incl. MS
// Office `[if mso]` conditionals), <head>, and scripts/styles. Swap for a
// library like `html-to-text` later without touching callers if needed.
const htmlToText = (html) =>
  html
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Recursively walk the MIME tree, accumulating text/html bodies and attachment
// metadata. A part with a filename is treated as an attachment (we capture
// metadata only, never the bytes — matches the current scope).
const walkParts = (part, acc) => {
  if (!part) return acc;

  const mimeType = part.mimeType || "";
  const filename = part.filename || "";

  if (filename) {
    const disposition = getHeader(part.headers, "Content-Disposition");
    // Inline parts (logos/images the HTML references) are not real attachments;
    // flag them so triage doesn't treat every newsletter as an attachment.
    const isInline =
      /^\s*inline/i.test(disposition) ||
      (!!getHeader(part.headers, "Content-ID") && /^image\//i.test(mimeType));

    acc.attachments.push({
      filename,
      mimeType,
      size: part.body?.size || 0,
      attachmentId: part.body?.attachmentId || null,
      inline: isInline,
    });
  } else if (mimeType === "text/plain" && part.body?.data) {
    acc.text += decodeBody(part.body.data);
  } else if (mimeType === "text/html" && part.body?.data) {
    acc.html += decodeBody(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) walkParts(child, acc);
  }

  return acc;
};

// Turn a full Gmail message resource (the `data` from messages.get) into a flat,
// clean email object with no raw payload.
const parseEmail = (message = {}) => {
  const payload = message.payload || {};
  const headers = payload.headers || [];

  const { text, html, attachments } = walkParts(payload, {
    text: "",
    html: "",
    attachments: [],
  });

  // Prefer the real plain-text part; fall back to stripped HTML so `text` is
  // populated even for HTML-only emails. Normalize either way for readability.
  const bodyText = normalizeText(text.trim() ? text : html ? htmlToText(html) : "");

  return {
    id: message.id,
    threadId: message.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    // Message-ID is needed to thread a reply correctly (In-Reply-To/References).
    messageId: getHeader(headers, "Message-ID"),
    // Signals used to skip bulk/automated senders when auto-replying.
    listUnsubscribe: getHeader(headers, "List-Unsubscribe"),
    precedence: getHeader(headers, "Precedence"),
    autoSubmitted: getHeader(headers, "Auto-Submitted"),
    snippet: message.snippet || "",
    text: bodyText,
    html,
    attachments,
  };
};

module.exports = { parseEmail, decodeBody, htmlToText, getHeader };
