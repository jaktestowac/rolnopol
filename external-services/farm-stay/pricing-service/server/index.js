/**
 * Pricing REST service — standalone process (:4311). Stateless.
 * Start with:  npm run farmstay:pricing
 *
 *   GET  /health
 *   POST /v1/quotes  { propertyId, basePrice, from, to, guests }
 */
const express = require("express");
const { HOST, PORT } = require("../config");
const { quote } = require("./handlers");
const dates = require("../../shared/dates");
const { createLogger } = require("../../shared/logger");

const log = createLogger("pricing");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({
      status: "SERVING",
      version: SERVICE_VERSION,
      uptime_ms: Date.now() - startedAt,
      stateless: true,
    });
  });

  app.post("/v1/quotes", (req, res) => {
    const { basePrice, from, to } = req.body || {};
    if (typeof basePrice !== "number" || basePrice < 0) {
      return res.status(400).json({ error: "basePrice must be a non-negative number" });
    }
    if (!dates.isValidRange(from, to)) {
      return res.status(400).json({ error: "from/to must be valid dates with from < to" });
    }
    try {
      const result = quote({ basePrice, from, to });
      res.json(result);
    } catch (err) {
      log.error("quote failed", { error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  return app;
}

function start() {
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "pricing", host: HOST, port: server.address().port });
  });
  const shutdown = (signal) => {
    log.info("shutting down", { signal });
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

if (require.main === module) start();

module.exports = { buildApp, start };
