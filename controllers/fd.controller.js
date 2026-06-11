const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logInfo } = require("../helpers/logger-api");
const { serviceUnavailable, wrap } = require("../services/fd/fd-controller-helper");

// Defensive loading — if fd.service or any sub-module fails, the app still starts
let farmDefenceService = null;
let fdServiceAvailable = false;
try {
  farmDefenceService = require("../services/fd.service");
  fdServiceAvailable = true;
} catch (err) {
  logError("[FarmDefenceController] Failed to load fd.service — FD endpoints will return 503:", err.message);
}

// Achievements/leaderboard are optional — load defensively so the core game
// endpoints keep working even if this sub-module fails.
let achievementsService = null;
try {
  achievementsService = require("../services/fd/achievements.service");
} catch (err) {
  logError("[FarmDefenceController] Failed to load achievements.service — achievement endpoints will return 503:", err.message);
}

const FD_VIEWPORT_SIZE = 20;

// Deprecated local helper – now delegated to fd-controller-helper
function _serviceUnavailable(res) {
  return serviceUnavailable(res);
}

class FarmDefenceController {
  async getFarmDefence(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    const result = await wrap(() => {
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      return farmDefenceService.getSnapshot({ viewportSize: FD_VIEWPORT_SIZE, compact: true, sessionId });
    }, null);
    if (result.error) {
      return res.status(result.status || 500).json(formatResponseBody({ error: result.error }));
    }
    return res.status(200).json(formatResponseBody({ data: result.data }));
  }

  async getFarmDefenceUpdates(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    const result = await wrap(() => {
      const since = Number(req.query?.since || 0);
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      return farmDefenceService.getUpdates(since, { viewportSize: FD_VIEWPORT_SIZE, compact: true, sessionId });
    }, null);
    if (result.error) {
      return res.status(result.status || 500).json(formatResponseBody({ error: result.error }));
    }
    const { data } = result;
    return res.status(200).json(formatResponseBody({ data, message: data?.message }));
  }

  async applyFarmDefenceAction(req, res) {
    if (!fdServiceAvailable) return _serviceUnavailable(res);
    const result = await wrap(
      () => {
        const { action, payload } = req.body;
        if (!action) {
          const err = new Error("Missing 'action' in request body");
          err.status = 400;
          throw err;
        }
        const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || req.body?.sessionId || null;
        return farmDefenceService.applyAction(action, payload || {}, { sessionId });
      },
      (err) => {
        const msg = err.message || "";
        return msg.includes("Unknown") ||
          msg.includes("requires") ||
          msg.includes("Not enough") ||
          msg.includes("Cannot build") ||
          msg.includes("already") ||
          msg.includes("already active") ||
          msg.includes("Game is over") ||
          msg.includes("Tower not found")
          ? 400
          : 500;
      },
    );
    if (result.error) {
      return res.status(result.status || 500).json(formatResponseBody({ error: result.error }));
    }
    return res.status(200).json(formatResponseBody({ data: result.data }));
  }

  async getFarmDefenceAchievements(req, res) {
    if (!achievementsService) return _serviceUnavailable(res);
    const result = await wrap(() => {
      const sessionId = req.get("x-fd-session-id") || req.query?.sessionId || "default";
      return achievementsService.getPlayerView(sessionId);
    }, null);
    if (result.error) {
      return res.status(result.status || 500).json(formatResponseBody({ error: result.error }));
    }
    return res.status(200).json(formatResponseBody({ data: result.data }));
  }

  async getFarmDefenceLeaderboard(req, res) {
    if (!achievementsService) return _serviceUnavailable(res);
    const result = await wrap(() => {
      const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
      return achievementsService.getLeaderboard(limit);
    }, null);
    if (result.error) {
      return res.status(result.status || 500).json(formatResponseBody({ error: result.error }));
    }
    return res.status(200).json(formatResponseBody({ data: result.data }));
  }
}

module.exports = new FarmDefenceController();
