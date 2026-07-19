const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logDebug } = require("../helpers/logger-api");
const createWeatherLiveService = require("../services/weather-live.service");

const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 60000;
const HEARTBEAT_MS = 15000;
const MAX_LIMIT = 10000;

/**
 * WeatherLiveController — exposes the live weather feed built by
 * services/weather-live.service.js as:
 *   - GET /weather/live         → a single JSON conditions snapshot (+ alerts)
 *   - GET /weather/live/stream  → a Server-Sent Events (SSE) stream of
 *                                 `conditions` and `alert` events.
 *
 * SSE notes:
 *   - Content-Type: text/event-stream, kept open; a `: keep-alive` heartbeat is
 *     sent every 15s so proxies/clients don't time the connection out.
 *   - Every event carries a monotonic `id:` so a reconnecting EventSource can
 *     resume via Last-Event-ID (the client stays consistent with the base day).
 *   - `alert` events are de-duplicated: an alert is emitted only when it first
 *     becomes active, not on every frame it stays active.
 *   - `?limit=N` closes the stream after N `conditions` frames — this makes the
 *     otherwise never-ending stream testable with supertest, and is also handy
 *     for bounded demos. `?variance=0` disables sub-daily jitter (base values
 *     verbatim), `?intervalMs=` controls cadence, `?seed=` varies the jitter.
 */
class WeatherLiveController {
  _todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  _resolveParams(req) {
    const service = createWeatherLiveService("PL-14");
    const region = service.normalizeRegion(req.query.region || "PL-14");

    const requestedDate = String(req.query.date || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : this._todayIso();

    const seed = typeof req.query.seed === "string" ? req.query.seed : "";

    const requestedVariance = Number(req.query.variance);
    const variance = Number.isFinite(requestedVariance) ? Math.max(0, Math.min(3, requestedVariance)) : 1;

    const requestedInterval = Number.parseInt(req.query.intervalMs, 10);
    const intervalMs = Number.isFinite(requestedInterval)
      ? Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, requestedInterval))
      : DEFAULT_INTERVAL_MS;

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(MAX_LIMIT, requestedLimit) : null;

    return { service, region, date, seed, variance, intervalMs, limit };
  }

  async getLive(req, res) {
    try {
      const { service, region, date, seed, variance } = this._resolveParams(req);
      const frame = service.generateFrame({
        region,
        date,
        seed,
        variance,
        tick: 0,
        observedAt: new Date().toISOString(),
      });

      return res.status(200).json(
        formatResponseBody({
          data: {
            seed: date,
            conditions: frame.conditions,
            alerts: frame.alerts,
          },
        }),
      );
    } catch (error) {
      logError("Error getting live weather snapshot", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to get live weather snapshot",
        }),
      );
    }
  }

  streamLive(req, res) {
    let params;
    try {
      params = this._resolveParams(req);
    } catch (error) {
      logError("Error resolving live weather stream params", { error });
      return res.status(400).json(
        formatResponseBody({
          error: error?.message || "Failed to start live weather stream",
        }),
      );
    }

    const { service, region, date, seed, variance, intervalMs, limit } = params;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    let eventId = 0;
    let tick = 0;
    let conditionsSent = 0;
    let closed = false;
    let timer = null;
    let heartbeat = null;
    const activeAlertKeys = new Set();

    const write = (chunk) => {
      if (closed) {
        return;
      }
      try {
        res.write(chunk);
      } catch (error) {
        logDebug("Live weather stream write failed", { error: error?.message });
      }
    };

    const sendEvent = (event, data) => {
      eventId += 1;
      write(`id: ${eventId}\n`);
      write(`event: ${event}\n`);
      write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    };

    const emitFrame = () => {
      if (closed) {
        return;
      }

      const frame = service.generateFrame({
        region,
        date,
        seed,
        variance,
        tick,
        observedAt: new Date().toISOString(),
      });

      sendEvent("conditions", frame.conditions);
      conditionsSent += 1;
      tick += 1;

      // Emit an alert only the first time its key becomes active.
      const currentKeys = new Set();
      for (const alert of frame.alerts) {
        currentKeys.add(alert.key);
        if (!activeAlertKeys.has(alert.key)) {
          sendEvent("alert", alert);
        }
      }
      activeAlertKeys.clear();
      for (const key of currentKeys) {
        activeAlertKeys.add(key);
      }

      if (limit && conditionsSent >= limit) {
        sendEvent("complete", { conditionsSent });
        cleanup();
        try {
          res.end();
        } catch (error) {
          logDebug("Live weather stream end failed", { error: error?.message });
        }
      }
    };

    req.on("close", () => {
      cleanup();
    });

    // Initial snapshot right away so the client paints immediately.
    emitFrame();

    if (!closed) {
      timer = setInterval(emitFrame, intervalMs);
      if (typeof timer.unref === "function") {
        timer.unref();
      }

      heartbeat = setInterval(() => {
        write(`: keep-alive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);
      if (typeof heartbeat.unref === "function") {
        heartbeat.unref();
      }
    }
  }
}

module.exports = new WeatherLiveController();
module.exports.WeatherLiveController = WeatherLiveController;
