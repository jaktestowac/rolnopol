const { formatResponseBody } = require("../helpers/response-helper");
const { logDebug, logError } = require("../helpers/logger-api");

class TestingController {
  async webhookSink(req, res) {
    try {
      const receivedAt = new Date().toISOString();
      const body = typeof req.body === "undefined" ? null : req.body;
      const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;

      logDebug("Testing webhook sink received request", {
        method: req.method,
        path: req.originalUrl,
        contentType,
      });

      return res.status(202).json(
        formatResponseBody({
          message: "Mock webhook accepted",
          data: {
            sink: "webhook",
            endpoint: "/api/v1/testing/webhooks/sink",
            receivedAt,
            method: req.method,
            path: req.originalUrl,
            contentType,
            body,
            query: req.query || {},
          },
        }),
      );
    } catch (error) {
      logError("Failed to process testing webhook sink request", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to process testing webhook sink request",
        }),
      );
    }
  }
}

module.exports = new TestingController();
