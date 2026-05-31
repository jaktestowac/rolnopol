const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const farmerTapeRecorderService = require("../services/farmer-tape-recorder.service");

function getSessionId(req) {
  return req.get("x-farmer-tape-session-id") || req.query?.sessionId || req.body?.sessionId || null;
}

class FarmerTapeRecorderController {
  async getTapeRecorder(req, res) {
    try {
      const data = farmerTapeRecorderService.getSnapshot({ sessionId: getSessionId(req) });
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting farmer tape recorder snapshot:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get farmer tape recorder snapshot" }));
    }
  }

  async applyAction(req, res) {
    try {
      const action = req.body?.action || req.body?.type;
      const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : req.body || {};
      const data = farmerTapeRecorderService.applyAction(action, payload, { sessionId: getSessionId(req) });
      return res.status(200).json(formatResponseBody({ data, message: data.message }));
    } catch (error) {
      logError("Error applying farmer tape recorder action:", error);
      const status = Number.isFinite(error?.statusCode) ? error.statusCode : 500;
      const message = typeof error?.message === "string" ? error.message : "Failed to apply tape recorder action";
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }
}

module.exports = new FarmerTapeRecorderController();
