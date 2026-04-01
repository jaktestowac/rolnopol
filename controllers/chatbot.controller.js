const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const chatbotService = require("../services/chatbot/chatbot.service");

class ChatbotController {
  _resolveStatusCode(error) {
    if (!error || !error.message) {
      return 500;
    }

    if (error.message.includes("Validation failed")) {
      return 400;
    }

    return 500;
  }

  async sendMessage(req, res) {
    try {
      const data = await chatbotService.ask({
        userId: req.user.userId,
        message: req.body?.message,
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
}

module.exports = new ChatbotController();
