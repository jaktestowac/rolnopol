const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const webhookController = require("../../controllers/webhook.controller");

const webhooksRoute = express.Router();
const apiLimiter = createRateLimiter("api");

webhooksRoute.get(
  "/users/profile/webhooks/events",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.listEvents.bind(webhookController),
);

webhooksRoute.get(
  "/users/profile/webhooks/deliveries",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.listDeliveries.bind(webhookController),
);

webhooksRoute.get(
  "/users/profile/webhooks",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.list.bind(webhookController),
);

webhooksRoute.post(
  "/users/profile/webhooks",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.create.bind(webhookController),
);

webhooksRoute.put(
  "/users/profile/webhooks/:webhookId",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.update.bind(webhookController),
);

webhooksRoute.delete(
  "/users/profile/webhooks/:webhookId",
  apiLimiter,
  requireFeatureFlag("integrationsWebhooksEnabled", { resourceName: "Webhooks" }),
  authenticateSessionUser,
  webhookController.remove.bind(webhookController),
);

module.exports = webhooksRoute;
