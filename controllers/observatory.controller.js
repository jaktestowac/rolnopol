const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logDebug } = require("../helpers/logger-api");
const observatoryService = require("../services/observatory.service");

const HEARTBEAT_MS = 15000;
const MAX_LIMIT = 10000;
// Mirrors the client's former polling tiers (public/js/pages/observatory.js):
// paused streams never re-tick, everything else scales with the requested
// time-flow speed so a sped-up sky still looks smooth.
const MAX_TIME_SCALE = 100000;

function resolveTickIntervalMs(timeScale) {
  if (timeScale <= 0) return null;
  if (timeScale <= 1) return 2000;
  if (timeScale <= 60) return 1000;
  return 500;
}

class ObservatoryController {
  _buildSnapshot(req, timestampOverride) {
    return observatoryService.getSnapshot({
      timestamp: timestampOverride !== undefined ? timestampOverride : req.query?.timestamp,
      presetId: req.query?.presetId,
      latitudeDeg: req.query?.latitude,
      longitudeDeg: req.query?.longitude,
      magnitudeLimit: req.query?.magnitudeLimit,
    });
  }

  async getSnapshot(req, res) {
    try {
      const data = this._buildSnapshot(req);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting observatory snapshot", { error });
      const statusCode = Number.isFinite(error?.statusCode) ? error.statusCode : 500;
      const message = typeof error?.message === "string" ? error.message : "Failed to get observatory snapshot";
      return res.status(statusCode).json(formatResponseBody({ error: message }));
    }
  }

  /**
   * Server-Sent Events stream of observatory snapshots. Replaces the client's
   * former REST-polling loop: the connection carries its own simulated clock
   * (anchored at the requested `timestamp`, advanced by `timeScale`) and pushes
   * a `snapshot` event each tick, so the browser no longer needs to re-fetch on
   * a timer. Changing location, magnitude limit, or time scale means opening a
   * new stream with updated query params (the client does this automatically).
   */
  streamSnapshot(req, res) {
    let initialData;
    let simulatedTimeMs;
    try {
      initialData = this._buildSnapshot(req);
      simulatedTimeMs = new Date(initialData.simulation.requestedTimestamp).getTime();
    } catch (error) {
      logError("Error starting observatory stream", { error });
      const statusCode = Number.isFinite(error?.statusCode) ? error.statusCode : 500;
      const message = typeof error?.message === "string" ? error.message : "Failed to start observatory stream";
      return res.status(statusCode).json(formatResponseBody({ error: message }));
    }

    const requestedTimeScale = Number(req.query?.timeScale);
    const timeScale = Number.isFinite(requestedTimeScale) ? Math.min(MAX_TIME_SCALE, Math.max(0, requestedTimeScale)) : 1;

    // Optional cadence override (mainly for tests/demos) — still respects pause:
    // timeScale=0 never ticks regardless of this override.
    const requestedTickIntervalMs = Number.parseInt(req.query?.tickIntervalMs, 10);
    const tickIntervalOverrideMs = Number.isFinite(requestedTickIntervalMs) ? Math.max(50, Math.min(60000, requestedTickIntervalMs)) : null;
    const tickIntervalMs = timeScale <= 0 ? null : (tickIntervalOverrideMs ?? resolveTickIntervalMs(timeScale));

    const requestedLimit = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(MAX_LIMIT, requestedLimit) : null;

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
    let snapshotsSent = 0;
    let closed = false;
    let tickTimer = null;
    let heartbeatTimer = null;
    let lastTickAtMs = Date.now();

    const write = (chunk) => {
      if (closed) {
        return;
      }
      try {
        res.write(chunk);
      } catch (error) {
        logDebug("Observatory stream write failed", { error: error?.message });
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
      if (tickTimer) {
        clearInterval(tickTimer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    };

    const finishIfAtLimit = () => {
      if (!limit || snapshotsSent < limit) {
        return false;
      }
      sendEvent("complete", { snapshotsSent });
      cleanup();
      try {
        res.end();
      } catch (error) {
        logDebug("Observatory stream end failed", { error: error?.message });
      }
      return true;
    };

    const emitTick = () => {
      if (closed) {
        return;
      }

      const now = Date.now();
      const elapsedRealMs = now - lastTickAtMs;
      lastTickAtMs = now;
      simulatedTimeMs += elapsedRealMs * timeScale;

      let data;
      try {
        data = this._buildSnapshot(req, new Date(simulatedTimeMs).toISOString());
      } catch (error) {
        logError("Error computing observatory tick", { error });
        return;
      }

      sendEvent("snapshot", data);
      snapshotsSent += 1;
      finishIfAtLimit();
    };

    req.on("close", cleanup);

    sendEvent("snapshot", initialData);
    snapshotsSent += 1;

    if (!finishIfAtLimit() && tickIntervalMs) {
      tickTimer = setInterval(emitTick, tickIntervalMs);
      if (typeof tickTimer.unref === "function") {
        tickTimer.unref();
      }
    }

    if (!closed) {
      heartbeatTimer = setInterval(() => {
        write(`: keep-alive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);
      if (typeof heartbeatTimer.unref === "function") {
        heartbeatTimer.unref();
      }
    }
  }
}

module.exports = new ObservatoryController();
