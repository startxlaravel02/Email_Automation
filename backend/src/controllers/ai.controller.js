const { generateReply } = require("../services/ollama.service");
const { buildReplyPrompt } = require("../utils/promptBuilder");

// POST /api/ai/reply  ->  generate a reply from a raw email string.
// Kept for manual testing (Postman) — the Gmail-driven flow lives in
// email.controller.js.
const generateEmailReply = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Field 'email' (string) is required.",
      });
    }

    // Reuse the shared prompt builder. This also fixes the previous bug where
    // the customer's email was never actually inserted into the prompt.
    const prompt = buildReplyPrompt({ text: email });

    const reply = await generateReply(prompt);

    res.json({ success: true, reply });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { generateEmailReply };
