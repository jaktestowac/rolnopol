const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const messengerService = require("../services/messenger.service");

class MessengerController {
  _resolveStatusCode(error) {
    if (!error || !error.message) {
      return 500;
    }

    if (error.message.includes("Validation failed")) return 400;
    if (error.message.includes("forbidden") || error.message.includes("blocked")) return 403;
    if (error.message.includes("not found")) return 404;
    if (error.message.includes("deactivated")) return 401;
    return 500;
  }

  async listConversations(req, res) {
    try {
      const conversations = await messengerService.getConversations(req.user.userId);
      return res.status(200).json(
        formatResponseBody({
          data: conversations,
        }),
      );
    } catch (error) {
      logError("Error listing conversations:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  async getConversation(req, res) {
    try {
      const data = await messengerService.getConversation(req.user.userId, req.params.userId, req.query || {});
      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      logError("Error getting conversation:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  async sendMessage(req, res) {
    try {
      const data = await messengerService.sendMessage(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Message sent successfully",
          data,
        }),
      );
    } catch (error) {
      logError("Error sending message:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  async pollMessages(req, res) {
    try {
      const { withUserId, since } = req.query || {};
      const data = await messengerService.pollMessages(req.user.userId, withUserId, since);
      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      logError("Error polling messages:", error);
      return res.status(this._resolveStatusCode(error)).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }
}

module.exports = new MessengerController();
