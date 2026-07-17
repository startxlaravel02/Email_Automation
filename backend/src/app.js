const path = require("path");
const express = require("express");
const cors = require("cors");

const aiRoutes = require("./routes/ai.routes");
const emailRoutes = require("./routes/email.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const trackRoutes = require("./routes/track.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const engagementRoutes = require("./routes/engagement.routes");
const { requireApiKey } = require("./middleware/auth");



const app = express();

app.set("trust proxy", 1); // so req.ip uses X-Forwarded-For behind Render


app.use(cors());
app.use(express.json());

// Minimal dashboard UI (static HTML) served from backend/public.
app.use(express.static(path.join(__dirname, "../public")));

app.use("/api/ai", aiRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/track", trackRoutes);
app.use("/api/analytics", analyticsRoutes);

// Open Intelligence engagement APIs — behind API-key auth (engagement data is private).
app.use("/api/engagement", requireApiKey, engagementRoutes);



app.get("/health", (req, res) => {
  res.json({ success: true, message: "AI Email Backend Running" });
});

module.exports = app;
