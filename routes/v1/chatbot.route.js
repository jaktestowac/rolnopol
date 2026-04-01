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

module.exports = chatbotRoute;
