const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const chatbotController = require("../../controllers/chatbot.controller");
const { INSTRUMENTALITY_ORACLE_BOT_ID } = require("../../services/chatbot/bots/bot-registry");

const chatbotRoute = express.Router();
const apiLimiter = createRateLimiter("high");
const requireAssistantChatFeature = requireFeatureFlag("assistantChatEnabled", { resourceName: "Assistant Chat" });

function isInstrumentalityOracleRequest(req) {
  const queryBotId = typeof req.query?.botId === "string" ? req.query.botId.trim() : "";
  const bodyBotId = typeof req.body?.botId === "string" ? req.body.botId.trim() : "";
  return (bodyBotId || queryBotId) === INSTRUMENTALITY_ORACLE_BOT_ID;
}

function authenticateAssistantChatStream(req, res, next) {
  if (isInstrumentalityOracleRequest(req)) {
    req.user = { userId: null };
    req.auth = { type: "public", botId: INSTRUMENTALITY_ORACLE_BOT_ID };
    return next();
  }

  return requireAssistantChatFeature(req, res, (featureError) => {
    if (featureError) {
      return next(featureError);
    }

    return authenticateUser(req, res, next);
  });
}

chatbotRoute.post(
  "/assistant-chat/messages",
  apiLimiter,
  requireAssistantChatFeature,
  authenticateUser,
  chatbotController.sendMessage.bind(chatbotController),
);

chatbotRoute.post(
  "/assistant-chat/stream",
  apiLimiter,
  authenticateAssistantChatStream,
  chatbotController.streamMessage.bind(chatbotController),
);

chatbotRoute.post(
  "/docs-chat/messages",
  apiLimiter,
  requireFeatureFlag("docsAiAssistantEnabled", { resourceName: "Documentation Assistant" }),
  chatbotController.sendDocsMessage.bind(chatbotController),
);

chatbotRoute.post(
  "/alerts-chat/messages",
  apiLimiter,
  requireFeatureFlag("alertsEnabled", { resourceName: "Alerts" }),
  requireFeatureFlag("alertsAiAssistantEnabled", { resourceName: "Alerts Assistant" }),
  chatbotController.sendAlertsMessage.bind(chatbotController),
);

module.exports = chatbotRoute;
