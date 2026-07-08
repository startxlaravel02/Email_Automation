// Decides whether an incoming email should get an automatic AI reply.
//
// Auto-replying to newsletters, security alerts, or mailer-daemons is noise (or
// worse, once we auto-send). This filter skips bulk/automated/no-reply senders.
// Policy lives here; the raw signals it reads come from emailParser.

const NO_REPLY =
  /no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@/i;

const shouldAutoReply = (email = {}) => {
  const from = email.from || "";

  if (NO_REPLY.test(from)) return { ok: false, reason: "no-reply sender" };

  if (email.listUnsubscribe)
    return { ok: false, reason: "bulk (List-Unsubscribe header)" };

  if (/bulk|list|junk/i.test(email.precedence || ""))
    return { ok: false, reason: "bulk (Precedence header)" };

  if (/auto-(generated|replied)/i.test(email.autoSubmitted || ""))
    return { ok: false, reason: "auto-submitted" };

  if (!email.text || !email.text.trim())
    return { ok: false, reason: "empty body" };

  return { ok: true };
};

module.exports = { shouldAutoReply };
