const {
  listUnprocessedMessages,
  getEmail,
  getThread,
  createDraftReply,
  sendReply,
  getOrCreateLabelId,
  addLabel,
} = require("./gmailService");
const { generateReply } = require("./ollama.service");
const {
  buildReplyPrompt,
  buildThreadReplyPrompt,
} = require("../utils/promptBuilder");
const { shouldAutoReply } = require("../utils/emailFilter");
const {
  hasRealAttachments,
  getRealAttachments,
} = require("../utils/attachments");
const { holdingReplyForAttachment } = require("../utils/templates");
const { recordEmail, recordReply, emailExists } = require("../models/email.model");
const { isAiEnabled } = require("../models/settings.model");
const { isThreadPaused } = require("../models/thread.model");
const { sendTracked } = require("./trackingService");
const { isSuppressed } = require("../models/tracking.model");
const { enqueueForThread } = require("../engagement/engagementService");


const INTERVAL = Number(process.env.POLL_INTERVAL_MS || 10000);
const MAX_RESULTS = Number(process.env.POLL_MAX_RESULTS || 10);
const LABEL = process.env.PROCESSED_LABEL || "AI-Processed";
const SKIPPED_LABEL = process.env.SKIPPED_LABEL || "AI-Skipped";
const ACTION_LABEL = process.env.ACTION_REQUIRED_LABEL || "Action Required";
// Emails tracked-only (AI off or thread paused) get this label so the poller
// stops re-listing them every cycle. Catch-up removes it; skip swaps it for SKIPPED.
const PENDING_LABEL = process.env.PENDING_LABEL || "AI-Pending";

// When AUTO_SEND=true the reply is SENT immediately; otherwise it's a draft.
const AUTO_SEND = process.env.AUTO_SEND === "true";
const MODE = AUTO_SEND ? "sent" : "drafted"; // for logs
const DELIVERY = AUTO_SEND ? "sent" : "draft"; // for the DB enum

// Deliver a reply — send it or save a draft, per AUTO_SEND.
function deliver(payload) {
  return AUTO_SEND ? sendTracked(payload) : createDraftReply(payload);
}


// Persist what happened to MySQL. DB problems must never break email handling,
// so failures are logged and swallowed.
async function logOutcome(email, { status, reason = null }, reply = null) {
  try {
    const emailId = await recordEmail({
      gmailId: email.id,
      threadId: email.threadId,
      sender: email.from,
      subject: email.subject,
      snippet: email.snippet,
      status,
      reason,
      emailDate: email.date,
    });
    const replyId = reply ? await recordReply({ emailId, ...reply }) : null;
    return { emailId, replyId };
  } catch (err) {
    console.error(`  ↳ db log failed: ${err.message}`);
    return {};
  }
}


// Build the reply prompt: conversation context for ongoing threads, else the
// fast single-message path.
async function buildPromptFor(email) {
  const thread = await getThread(email.threadId);

  if (thread.length > 1) {
    return {
      prompt: buildThreadReplyPrompt({ messages: thread }),
      context: thread.length,
    };
  }

  return {
    prompt: buildReplyPrompt({
      from: email.from,
      subject: email.subject,
      text: email.text,
    }),
    context: 0,
  };
}

// Handle one email end-to-end: filter -> triage -> reply -> label -> record.
// Receives the already-fetched email object (the poller fetches it once).
async function processMessage(email, labels) {
  const startedAt = Date.now();
  const id = email.id;

  const decision = shouldAutoReply(email);
  if (!decision.ok) {
    console.log(`  ↳ skip (${decision.reason}) — ${email.from}`);
    await addLabel(id, labels.skipped);
    await logOutcome(email, { status: "skipped", reason: decision.reason });
    return;
  }

  // Suppression list — never email an unsubscribed/bounced address (auto-suppress).
const recipient = (email.from.match(/<([^>]+)>/)?.[1] || email.from).trim().toLowerCase();
if (await isSuppressed(recipient)) {
  console.log(`  ↳ suppressed — skip ${email.from}`);
  await addLabel(id, labels.skipped);
  await logOutcome(email, { status: "skipped", reason: "suppressed" });
  return;
}


  // Attachment triage: the model can't read files, so send/draft a holding
  // reply and flag the email "Action Required" for a human.
  if (hasRealAttachments(email)) {
    const body = holdingReplyForAttachment({
      from: email.from,
      attachments: getRealAttachments(email),
    });

    // Record the reply first so the tracked email can link back to it.
    const { replyId } = await logOutcome(
      email,
      { status: "escalated", reason: "attachment" },
      { body, deliveryMode: DELIVERY, usedContext: false, aiMs: null }
    );

    await deliver({
      to: email.from,
      subject: email.subject,
      body,
      threadId: email.threadId,
      inReplyTo: email.messageId,
      replyId,
    });
    await addLabel(id, labels.actionRequired);

    console.log(
      `  ↳ attachment → holding reply ${MODE} + "${ACTION_LABEL}" — ${email.from}`
    );
    return;
  }


  const { prompt, context } = await buildPromptFor(email);

  const aiStart = Date.now();
  const reply = await generateReply(prompt);
  const aiMs = Date.now() - aiStart;

  // Record inbound + reply first so the tracked email links to the reply row.
  const { replyId } = await logOutcome(
    email,
    { status: "replied" },
    { body: reply, deliveryMode: DELIVERY, usedContext: context > 1, aiMs }
  );

  await deliver({
    to: email.from,
    subject: email.subject,
    body: reply,
    threadId: email.threadId,
    inReplyTo: email.messageId,
    replyId,
  });
  await addLabel(id, labels.processed);


  const totalSecs = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ctx = context > 1 ? `${context} msgs` : "none";
  console.log(
    `  ↳ ${MODE} reply to "${email.subject}" — ${email.from} (ctx: ${ctx}, AI ${(aiMs / 1000).toFixed(1)}s, total ${totalSecs}s)`
  );
}

// One polling cycle.
//
// Engagement TRACKING (recording the inbound + reply detection) runs for EVERY new
// email regardless of the global AI toggle or a per-thread pause — a recipient reply
// is a human signal we always want. The AI *reply* only fires when the AI is on AND
// the thread isn't paused. Emails we don't reply to are recorded but left UNLABELED
// ("pending"), so they get caught up automatically when the AI is turned back on.
async function pollOnce() {
  const labels = {
    processed: await getOrCreateLabelId(LABEL),
    skipped: await getOrCreateLabelId(SKIPPED_LABEL),
    actionRequired: await getOrCreateLabelId(ACTION_LABEL),
    pending: await getOrCreateLabelId(PENDING_LABEL),
  };

  const messages = await listUnprocessedMessages(
    [LABEL, SKIPPED_LABEL, ACTION_LABEL, PENDING_LABEL],
    MAX_RESULTS
  );
  if (messages.length === 0) return;

  const aiEnabled = await isAiEnabled();
  const cycleStart = Date.now();
  console.log(`[poller] ${messages.length} new email(s)${aiEnabled ? "" : " — AI OFF (tracking only)"}`);

  for (const msg of messages) {
    try {
      const paused = await isThreadPaused(msg.threadId);

      if (aiEnabled && !paused) {
        // AI on + thread active → full handling (records inbound, replies, labels).
        const email = await getEmail(msg.id);
        await processMessage(email, labels);
        enqueueForThread(msg.threadId).catch((e) => console.error(`  ↳ engagement enqueue failed: ${e.message}`));
      } else {
        // AI off or thread paused → TRACK once (record inbound + trigger reply
        // detection). Only the first time do we record; but ALWAYS label AI-Pending
        // so the email stops being re-listed every cycle. Catch-up (on AI turn-on)
        // removes this label so the poller then replies.
        if (!(await emailExists(msg.id))) {
          const email = await getEmail(msg.id);
          await logOutcome(email, { status: "skipped", reason: aiEnabled ? "paused" : "ai_off" });
          enqueueForThread(msg.threadId).catch((e) => console.error(`  ↳ engagement enqueue failed: ${e.message}`));
          console.log(`  ↳ tracked only (${aiEnabled ? "paused thread" : "AI off"}) — ${email.from}`);
        }
        await addLabel(msg.id, labels.pending); // stops the every-cycle re-listing
      }
    } catch (err) {
      console.error(`  ↳ error on ${msg.id}: ${err.message}`);
    }
  }

  console.log(
    `[poller] cycle done — ${messages.length} email(s) in ${((Date.now() - cycleStart) / 1000).toFixed(1)}s`
  );
}

// Self-scheduling loop — cycles never overlap.
function startPolling() {
  console.log(
    `[poller] started — every ${INTERVAL}ms, mode=${AUTO_SEND ? "AUTO-SEND" : "DRAFT"}, dedupe label "${LABEL}"`
  );

  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error(`[poller] cycle error: ${err.message}`);
    }
    setTimeout(tick, INTERVAL);
  };

  tick();
}

module.exports = { startPolling, pollOnce };
