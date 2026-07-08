/**
 * Review-desk REST service — standalone process (:4312).
 * Start with:  npm run farmstay:reviews
 *
 *   GET  /health
 *   POST /v1/reviews         { propertyId, bookingId, author, rating, text }
 *   GET  /v1/reviews         ?propertyId=&page=
 *   POST /v1/scores          { propertyIds: [...] }
 *
 * Eligibility (was there a completed stay?) is the GATEWAY's job — the desk only
 * stores and aggregates, and rejects duplicate bookingId as defense-in-depth.
 */
const express = require("express");
const { HOST, PORT } = require("../config");
const db = require("./db");
const { nowIso } = require("../../shared/clock");
const { createLogger } = require("../../shared/logger");

const log = createLogger("review-desk");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();
const PAGE_SIZE = 20;

function scoresFor(reviews, propertyIds) {
  return propertyIds.map((propertyId) => {
    const forProp = reviews.filter((r) => r.propertyId === propertyId);
    const count = forProp.length;
    const avgRating = count ? Math.round((forProp.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
    return { propertyId, avgRating, count };
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", async (req, res) => {
    const data = await db.getAll().catch(() => null);
    res.json({
      status: "SERVING",
      version: SERVICE_VERSION,
      uptime_ms: Date.now() - startedAt,
      review_count: data?.reviews?.length || 0,
    });
  });

  app.post("/v1/reviews", async (req, res) => {
    const { propertyId, bookingId, author, rating, text } = req.body || {};
    if (!propertyId || !bookingId || !author) {
      return res.status(400).json({ error: "propertyId, bookingId, author are required" });
    }
    const numRating = Number(rating);
    if (!(numRating >= 1 && numRating <= 5)) {
      return res.status(400).json({ error: "rating must be 1-5" });
    }
    try {
      const result = await db.mutate((data) => {
        if (data.reviews.some((r) => r.bookingId === bookingId)) {
          return { value: { error: "ALREADY_EXISTS" } };
        }
        const seq = (data.seq || 0) + 1;
        const review = {
          id: `rev-${seq}`,
          propertyId,
          bookingId,
          author,
          rating: numRating,
          text: String(text || "").slice(0, 2000),
          createdAt: nowIso(),
        };
        return { next: { ...data, seq, reviews: [...data.reviews, review] }, value: { review } };
      });
      if (result.error === "ALREADY_EXISTS") {
        return res.status(409).json({ error: "A review already exists for this booking" });
      }
      log.info("review created", { id: result.review.id, property: propertyId });
      res.status(201).json(result.review);
    } catch (err) {
      log.error("create review failed", { error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/v1/reviews", async (req, res) => {
    try {
      const { propertyId } = req.query;
      const page = Math.max(1, Number(req.query.page) || 1);
      const data = await db.getAll();
      let reviews = data.reviews;
      if (propertyId) reviews = reviews.filter((r) => r.propertyId === propertyId);
      reviews = [...reviews].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const start = (page - 1) * PAGE_SIZE;
      const paged = reviews.slice(start, start + PAGE_SIZE);
      res.json({ reviews: paged, total: reviews.length, page });
    } catch (err) {
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/v1/scores", async (req, res) => {
    try {
      const propertyIds = Array.isArray(req.body?.propertyIds) ? req.body.propertyIds : [];
      const data = await db.getAll();
      res.json({ scores: scoresFor(data.reviews, propertyIds) });
    } catch (err) {
      res.status(500).json({ error: "Internal error" });
    }
  });

  return app;
}

async function start() {
  await db.init();
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "review-desk", host: HOST, port: server.address().port, path: db.DB_PATH });
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
