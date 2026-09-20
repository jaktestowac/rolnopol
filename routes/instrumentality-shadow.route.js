/**
 * Instrumentality Shadow routes (mounted at `/instrumentality/shadow`, before the
 * static handler in api/index.js).
 *
 *   GET  /instrumentality/shadow              → the page
 *   GET  /instrumentality/shadow?format=json  → { absorbed, since, recent }
 *   GET  /instrumentality/shadow/stream       → SSE stream of the same state
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

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get("/", (req, res) => {
  if (String(req.query.format || "").toLowerCase() === "json") {
    return res.json(shadow.snapshot());
  }
  return res.sendFile(PAGE);
});

router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  writeSse(res, "snapshot", shadow.snapshot());

  const unsubscribe = shadow.subscribe((state) => {
    writeSse(res, "snapshot", state);
  });
  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.all("/*", (req, res) => {
  shadow.absorb({ method: req.method, path: req.path });
  res.status(204).end();
});

module.exports = router;
