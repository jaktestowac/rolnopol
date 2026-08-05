/**
 * Instrumentality Shadow routes (mounted at `/instrumentality/shadow`, before the
 * static handler in api/index.js).
 *
 *   GET  /instrumentality/shadow              → the page
 *   GET  /instrumentality/shadow?format=json  → { absorbed, since, recent }
 *   ANY  /instrumentality/shadow/<anything>   → absorb a mirrored request, 204
 *
 * The wildcard is the Chaos Engine mirror target (see
 * services/instrumentality-shadow.service.js): mirroring appends the original
 * request path, so copies arrive as `/instrumentality/shadow/v1/users`. They are
 * counted and dropped — no auth, no persistence, no downstream effect. Deliberately
 * unrate-limited, since it exists to absorb a flood.
 */
const express = require("express");
const path = require("path");
const shadow = require("../services/instrumentality-shadow.service");

const router = express.Router();
const PAGE = path.join(__dirname, "..", "public", "instrumentality", "shadow.html");

router.get("/", (req, res) => {
  if (String(req.query.format || "").toLowerCase() === "json") {
    return res.json(shadow.snapshot());
  }
  return res.sendFile(PAGE);
});

router.all("/*", (req, res) => {
  shadow.absorb({ method: req.method, path: req.path });
  res.status(204).end();
});

module.exports = router;
