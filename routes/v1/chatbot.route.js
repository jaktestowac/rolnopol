const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const chatbotController = require("../../controllers/chatbot.controller");

const chatbotRoute = express.Router();
const apiLimiter = createRateLimiter("high");

chatbotRoute.post(
  "/assistant-chat/messages",
  apiLimiter,
  requireFeatureFlag("assistantChatEnabled", { resourceName: "Assistant Chat" }),
  authenticateUser,
  chatbotController.sendMessage.bind(chatbotController),
);

chatbotRoute.post(
  "/assistant-chat/stream",
  apiLimiter,
  requireFeatureFlag("assistantChatEnabled", { resourceName: "Assistant Chat" }),
  authenticateUser,
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
