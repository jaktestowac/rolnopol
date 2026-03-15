const notificationCenter = require("../modules/notification-center");
const { logDebug } = require("../helpers/logger-api");

function publishNotificationEvent(event, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const action = safeOptions.action || "notification_publish";
  const meta = safeOptions.meta && typeof safeOptions.meta === "object" ? safeOptions.meta : {};

  try {
    const eventPublisher = notificationCenter.getEventPublisher();

    if (!eventPublisher || typeof eventPublisher.isEnabled !== "function" || typeof eventPublisher.publish !== "function") {
      return false;
    }

    if (!eventPublisher.isEnabled()) {
      return false;
    }

    eventPublisher.publish(event);
    return true;
  } catch (error) {
    logDebug("Notification publish skipped", {
      action,
      eventType: event?.type,
      error: error?.message,
      ...meta,
    });
    return false;
  }
}

module.exports = {
  publishNotificationEvent,
};
