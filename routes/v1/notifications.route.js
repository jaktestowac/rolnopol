const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const featureFlagsService = require("../../services/feature-flags.service");
const notificationCenterController = require("../../controllers/notification-center.controller");

const notificationsRoute = express.Router();
const apiLimiter = createRateLimiter("api");

async function requireNotificationCenterEnabled(req, res, next) {
  try {
    const data = await featureFlagsService.getFeatureFlags();
    const enabled = data?.flags?.notificationCenterEnabled === true;

    if (!enabled) {
      return res.status(404).json(
        formatResponseBody({
          error: "Notifications endpoint not found",
        }),
      );
    }

    return next();
  } catch {
    return res.status(404).json(
      formatResponseBody({
        error: "Notifications endpoint not found",
      }),
    );
  }
}

notificationsRoute.get(
  "/notifications/health",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.getHealth.bind(notificationCenterController),
);
notificationsRoute.get(
  "/notifications/events",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.getEvents.bind(notificationCenterController),
);
notificationsRoute.get(
  "/notifications/test-event",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.triggerTestEvent.bind(notificationCenterController),
);
notificationsRoute.post(
  "/notifications/test-event",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.triggerTestEvent.bind(notificationCenterController),
);
notificationsRoute.get(
  "/notifications/event-types",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.listEventTypes.bind(notificationCenterController),
);
notificationsRoute.get(
  "/notifications/trigger",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.triggerEvent.bind(notificationCenterController),
);
notificationsRoute.post(
  "/notifications/trigger",
  apiLimiter,
  requireNotificationCenterEnabled,
  notificationCenterController.triggerEvent.bind(notificationCenterController),
);

module.exports = notificationsRoute;
