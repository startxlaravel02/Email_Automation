const axios = require("axios");

// LLM generation can take a while, but it must not hang forever — an
// unbounded request ties up the connection if Ollama stalls. Configurable
// via env, defaults to 120s.
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT || 120000);

// Keep the model loaded in memory between requests so it isn't cold-loaded
// every time (a cold load adds seconds). "30m" keeps it warm for 30 minutes;
// set to "-1" to keep it resident indefinitely.
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

const generateReply = async (prompt) => {
    try {
        const response = await axios.post(
            `${process.env.OLLAMA_URL}/api/generate`,
            {
                model: process.env.OLLAMA_MODEL,
                prompt,
                stream: false,
                keep_alive: OLLAMA_KEEP_ALIVE,
            },
            { timeout: OLLAMA_TIMEOUT }
        );

        return response.data.response;
    } catch (error) {
        console.error(error.response?.data || error.message);

        throw new Error("AI generation failed");
    }
};

module.exports = {
    generateReply,
};
