const { formatResponseBody } = require("../helpers/response-helper");
const { logDebug, logError, logInfo } = require("../helpers/logger-api");

class TestingController {
  async webhookSink(req, res) {
    try {
      const receivedAt = new Date().toISOString();
      const body = typeof req.body === "undefined" ? null : req.body;
      const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
      const type = body?.type || "unknown";
      const payloadMessage = body?.payload?.message || "unknown";

      logInfo("Received request at testing webhook sink", {
        method: req.method,
        path: req.originalUrl,
        contentType,
        type,
        payloadMessage,
        query: req.query || {},
      });
      logDebug("Testing webhook sink received request", {
        method: req.method,
        path: req.originalUrl,
        contentType,
        type,
        payloadMessage,
        body,
        query: req.query || {},
      });

      // Prepare custom headers for the response
      const responseHeaders = {
        "X-Sink": "webhook",
        "X-Endpoint": "/api/v1/testing/webhooks/sink",
        "X-Received-At": receivedAt,
        "X-Webhook-Type": type,
      };
      const requestId = req.headers["x-request-id"] || req.headers["x-correlation-id"];
      if (requestId) {
        responseHeaders["X-Request-Id"] = requestId;
      }

      return res
        .status(202)
        .set(responseHeaders)
        .json(
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
