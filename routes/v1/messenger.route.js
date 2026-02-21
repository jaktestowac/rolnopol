const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { validateIdParam } = require("../../middleware/id-validation.middleware");
const messengerController = require("../../controllers/messenger.controller");

const messengerRoute = express.Router();
const apiLimiter = createRateLimiter("api");

messengerRoute.get(
  "/messages/conversations",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  messengerController.listConversations.bind(messengerController),
);

messengerRoute.get(
  "/messages/conversations/:userId",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  validateIdParam("userId"),
  messengerController.getConversation.bind(messengerController),
);

messengerRoute.post(
  "/messages",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  messengerController.sendMessage.bind(messengerController),
);

messengerRoute.get(
  "/messages/poll",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  messengerController.pollMessages.bind(messengerController),
);

module.exports = messengerRoute;
