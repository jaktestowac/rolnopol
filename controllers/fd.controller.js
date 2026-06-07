const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logInfo } = require("../helpers/logger-api");

// Defensive loading — if fd.service or any sub-module fails, the app still starts
let farmDefenceService = null;
let fdServiceAvailable = false;
try {
  farmDefenceService = require("../services/fd.service");
  fdServiceAvailable = true;
} catch (err) {
  logError("[FarmDefenceController] Failed to load fd.service — FD endpoints will return 503:", err.message);
}

const FD_VIEWPORT_SIZE = 20;

function _serviceUnavailable(res) {
  return res.status(503).json(formatResponseBody({ error: "Farm Defence service is currently unavailable" }));
}

class FarmDefenceController {
  async getFarmDefence(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    try {
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const data = farmDefenceService.getSnapshot({ viewportSize: FD_VIEWPORT_SIZE, compact: true, sessionId });
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting farm defence snapshot:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get farm defence snapshot" }));
    }
  }

  async getFarmDefenceUpdates(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    try {
      const since = Number(req.query?.since || 0);
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const data = farmDefenceService.getUpdates(since, { viewportSize: FD_VIEWPORT_SIZE, compact: true, sessionId });
      return res.status(200).json(formatResponseBody({ data, message: data.message }));
    } catch (error) {
      logError("Error getting farm defence updates:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get farm defence updates" }));
    }
  }

  async applyFarmDefenceAction(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    try {
      const { action, payload } = req.body;
      if (!action) {
        return res.status(400).json(formatResponseBody({ error: "Missing 'action' in request body" }));
      }
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const result = farmDefenceService.applyAction(action, payload || {}, { sessionId });
      return res.status(200).json(formatResponseBody({ data: result }));
    } catch (error) {
      logError("Error applying farm defence action:", error);
      const status =
        error.message.includes("Unknown") ||
        error.message.includes("requires") ||
        error.message.includes("Not enough") ||
        error.message.includes("Cannot build") ||
        error.message.includes("already") ||
        error.message.includes("already active") ||
        error.message.includes("Game is over") ||
        error.message.includes("Tower not found")
          ? 400
          : 500;
      return res.status(status).json(formatResponseBody({ error: error.message }));
    }
  }
}

module.exports = new FarmDefenceController();
