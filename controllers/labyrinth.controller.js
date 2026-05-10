const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const labyrinthService = require("../services/labyrinth.service");

const LABYRINTH_VIEWPORT_SIZE = 20;

class LabyrinthController {
  async getLabyrinth(req, res) {
    try {
      const sessionId = req.get("x-labyrinth-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const data = labyrinthService.getSnapshot({ viewportSize: LABYRINTH_VIEWPORT_SIZE, fogged: true, compact: true, sessionId });
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting labyrinth snapshot:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get labyrinth snapshot" }));
    }
  }

  async getLabyrinthUpdates(req, res) {
    try {
      const since = Number(req.query?.since || 0);
      const sessionId = req.get("x-labyrinth-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const data = labyrinthService.getUpdates(since, { viewportSize: LABYRINTH_VIEWPORT_SIZE, fogged: true, compact: true, sessionId });
      return res.status(200).json(formatResponseBody({ data, message: data.message }));
    } catch (error) {
      logError("Error getting labyrinth updates:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get labyrinth updates" }));
    }
  }

  async applyLabyrinthAction(req, res) {
    try {
      const sessionId = req.get("x-labyrinth-session-id") || req.query?.sessionId || req.body?.sessionId || null;
      const action = req.body?.action || req.body?.type;
      const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : req.body || {};
      const data = labyrinthService.applyAction(action, payload, {
        viewportSize: LABYRINTH_VIEWPORT_SIZE,
        fogged: true,
        compact: true,
        sessionId,
      });
      return res.status(200).json(formatResponseBody({ data, message: data.message }));
    } catch (error) {
      logError("Error applying labyrinth action:", error);
      const message = typeof error?.message === "string" ? error.message : "Failed to apply labyrinth action";
      const status = error?.statusCode || (message.includes("Unknown labyrinth action") ? 400 : 500);
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }
}

module.exports = new LabyrinthController();
