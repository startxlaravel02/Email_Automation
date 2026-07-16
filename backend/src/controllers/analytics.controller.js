const stats = require("../models/trackingStats.model");

// GET /api/analytics/dashboard  ->  everything the tracking dashboard needs, in one call
const getDashboard = async (req, res) => {
  try {
    const range = { from: req.query.from, to: req.query.to };
    const [overview, device, browser, client, country, mostClicked, recent, trend, heatmap] =
      await Promise.all([
        stats.getOverview(range),
        stats.getBreakdown("device", range),
        stats.getBreakdown("browser", range),
        stats.getBreakdown("client", range),
        stats.getBreakdown("country", range),
        stats.getMostClickedLinks(10, range),
        stats.getRecentActivity(50, range),
        stats.getEngagementTrend(14, range),
        stats.getClickHeatmap(range),
      ]);

    res.json({
      success: true,
      overview,
      breakdowns: { device, browser, client, country },
      mostClicked,
      recent,
      trend,
      heatmap,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load tracking dashboard" });
  }
};

// GET /api/analytics/recipients?q=...
const searchRecipients = async (req, res) => {
  try {
    res.json({ success: true, recipients: await stats.searchRecipients(req.query.q || "", 50) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to search recipients" });
  }
};

// GET /api/analytics/recipient?email=...
const recipientDetail = async (req, res) => {
  try {
    const email = (req.query.email || "").trim();
    if (!email) return res.status(400).json({ success: false, message: "email is required" });
    res.json({ success: true, ...(await stats.getRecipientDetail(email)) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Failed to load recipient" });
  }
};


module.exports = { getDashboard , searchRecipients ,recipientDetail};
