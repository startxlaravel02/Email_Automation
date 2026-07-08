const {
  listEmails,
  getEmail,
  getThread,
  createDraftReply,
  sendReply,
} = require("../services/gmailService");
const { generateReply } = require("../services/ollama.service");
const {
  buildReplyPrompt,
  buildThreadReplyPrompt,
} = require("../utils/promptBuilder");

// GET /api/emails  ->  list recent emails (lean, no html)
const getEmails = async (req, res) => {
  try {
    const emails = await listEmails();
    res.json({ success: true, count: emails.length, emails });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to fetch emails" });
  }
};

// GET /api/emails/:id  ->  one full email (includes html)
const getEmailById = async (req, res) => {
  try {
    const email = await getEmail(req.params.id);
    res.json({ success: true, email });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to fetch email" });
  }
};

// Shared: fetch the email + generate an AI reply, using conversation context
// when the email is part of an ongoing thread (2+ messages).
async function buildReplyFor(id) {
  const email = await getEmail(id);
  const thread = await getThread(email.threadId);

  const prompt =
    thread.length > 1
      ? buildThreadReplyPrompt({ messages: thread })
      : buildReplyPrompt({
          from: email.from,
          subject: email.subject,
          text: email.text,
        });

  const reply = await generateReply(prompt);
  return { email, reply };
}

// POST /api/emails/:id/reply  ->  generate an AI reply preview (touches nothing)
const generateReplyForEmail = async (req, res) => {
  try {
    const { email, reply } = await buildReplyFor(req.params.id);
    res.json({
      success: true,
      email: { id: email.id, from: email.from, subject: email.subject },
      reply,
    });
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to generate reply" });
  }
};

// POST /api/emails/:id/draft  ->  generate an AI reply AND save it as a Gmail
// Draft on the same thread. Nothing is sent — you review it in Gmail first.
const createDraftForEmail = async (req, res) => {
  try {
    const { email, reply } = await buildReplyFor(req.params.id);

    const draft = await createDraftReply({
      to: email.from,
      subject: email.subject,
      body: reply,
      threadId: email.threadId,
      inReplyTo: email.messageId,
    });

    res.json({
      success: true,
      email: { id: email.id, from: email.from, subject: email.subject },
      reply,
      draft: {
        id: draft.id,
        messageId: draft.message?.id,
        threadId: draft.message?.threadId,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to create draft" });
  }
};

// POST /api/emails/:id/send  ->  generate an AI reply AND send it immediately.
// ⚠️ This sends a REAL email to the sender. Use deliberately.
const sendReplyForEmail = async (req, res) => {
  try {
    const { email, reply } = await buildReplyFor(req.params.id);

    const sent = await sendReply({
      to: email.from,
      subject: email.subject,
      body: reply,
      threadId: email.threadId,
      inReplyTo: email.messageId,
    });

    res.json({
      success: true,
      email: { id: email.id, from: email.from, subject: email.subject },
      reply,
      sent: { id: sent.id, threadId: sent.threadId },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to send reply" });
  }
};

module.exports = {
  getEmails,
  getEmailById,
  generateReplyForEmail,
  createDraftForEmail,
  sendReplyForEmail,
};
