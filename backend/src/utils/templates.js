// Canned (non-AI) reply templates. A fixed template is safer and more
// predictable than asking the model for cases where we deliberately don't want
// the AI to answer — e.g. an email with attachments it can't read.

const COMPANY_NAME = process.env.COMPANY_NAME || "Start X";

// Pull a friendly name out of a "Display Name <addr@x.com>" header.
const nameFromHeader = (from = "") => {
  const display = from.split("<")[0].trim().replace(/^"|"$/g, "");
  return display || "there";
};

const holdingReplyForAttachment = ({ from = "", attachments = [] }) => {
  const name = nameFromHeader(from);
  const files = attachments.map((a) => a.filename).filter(Boolean);
  const fileLine = files.length
    ? ` and the attached ${files.length > 1 ? "files" : "file"} (${files.join(", ")})`
    : " and your attachment";

  return `Dear ${name},

Thank you for your email${fileLine}. Our team has received it, and one of our representatives will review the details and get back to you shortly.

Best regards,
${COMPANY_NAME}`;
};

module.exports = { holdingReplyForAttachment, nameFromHeader };
