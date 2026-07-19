const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logDebug } = require("../helpers/logger-api");
const chatbotService = require("../services/chatbot/chatbot.service");
const { ALERTS_GUIDE_BOT_ID, DOCS_GUIDE_BOT_ID } = require("../services/chatbot/bots/bot-registry");

class ChatbotController {
  _resolveBotId(req) {
    const queryBotId = typeof req.query?.botId === "string" ? req.query.botId : "";
    const bodyBotId = typeof req.body?.botId === "string" ? req.body.botId : "";
    return bodyBotId.trim() || queryBotId.trim() || undefined;
  }

  _resolveStatusCode(error) {
    if (!error || !error.message) {
      return 500;
    }

    if (error.message.includes("Validation failed")) {
      return 400;
    }

    return 500;
  }

  _resolveAlertsRequestContext(req) {
    const region = typeof req.body?.region === "string" ? req.body.region.trim() : "";
    const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";

    return {
      region,
      date,
    };
  }

  async sendMessage(req, res) {
    try {
      const data = await chatbotService.ask({
        userId: req.user.userId,
        message: req.body?.message,
        botId: this._resolveBotId(req),
      });

      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      logError("Error while generating chatbot response:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Token-by-token streaming of the assistant reply over Server-Sent Events.
   *
   * Emits:
   *   - event: start  { provider, botId, botName }
   *   - event: token  { delta }        (repeated as tokens arrive)
   *   - event: done   { reply, usage, contextSummary }
   *   - event: error  { error }        (on failure, before closing)
   *
   * The message is taken from the POST body. A client disconnect aborts the
   * upstream provider call (cost control). Unlike the public weather stream,
   * the browser reads this with fetch() (not EventSource) so it can send the
   * `token` auth header and a POST body.
   */
  async streamMessage(req, res) {
    const abortController = new AbortController();
    let closed = false;

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
    const sendEvent = (event, data) => {
      if (closed) {
        return;
      }
      try {
        eventId += 1;
        res.write(`id: ${eventId}\n`);
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        logDebug("Assistant chat stream write failed", { error: error?.message });
      }
    };

    req.on("close", () => {
      if (!closed) {
        closed = true;
        abortController.abort();
      }
    });

    try {
      const stream = chatbotService.askStream({
        userId: req.user.userId,
        message: req.body?.message,
        botId: this._resolveBotId(req),
        signal: abortController.signal,
      });

      for await (const chunk of stream) {
        if (closed) {
          break;
        }
        sendEvent(chunk.type, chunk);
      }
    } catch (error) {
      logError("Error while streaming chatbot response:", error);
      sendEvent("error", { error: error?.message || "Failed to stream assistant response" });
    } finally {
      if (!closed) {
        closed = true;
        try {
          res.end();
        } catch (error) {
          logDebug("Assistant chat stream end failed", { error: error?.message });
        }
      }
    }
  }

  async sendDocsMessage(req, res) {
    try {
      const data = await chatbotService.ask({
        userId: null,
        message: req.body?.message,
        botId: DOCS_GUIDE_BOT_ID,
      });

      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      logError("Error while generating docs chatbot response:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  async sendAlertsMessage(req, res) {
    try {
      const data = await chatbotService.ask({
        userId: null,
        message: req.body?.message,
        botId: ALERTS_GUIDE_BOT_ID,
        requestContext: this._resolveAlertsRequestContext(req),
      });

      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      logError("Error while generating alerts chatbot response:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }
}

module.exports = new ChatbotController();
