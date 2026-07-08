// Attachment helpers for triage.
//
// Gmail exposes embedded images (logos referenced by the HTML) as parts too, so
// emailParser marks those `inline: true`. "Real" attachments are the non-inline
// ones — the files a customer actually sent (PDFs, docs, zips, ...).

const getRealAttachments = (email = {}) =>
  (email.attachments || []).filter((a) => !a.inline);

const hasRealAttachments = (email) => getRealAttachments(email).length > 0;

module.exports = { getRealAttachments, hasRealAttachments };
