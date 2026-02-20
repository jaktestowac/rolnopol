const express = require("express");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const metrics = require("../../helpers/prometheus-metrics");

const router = express.Router();

router.get("/metrics", requireFeatureFlag("prometheusMetricsEnabled", { resourceName: "Metrics" }), (req, res) => {
  try {
    const output = metrics.collect();
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.status(200).send(output);
  } catch (error) {
    return res.status(500).json({
      success: false,
      timestamp: new Date().toISOString(),
      error: "Failed to collect metrics",
    });
  }
});

module.exports = router;
