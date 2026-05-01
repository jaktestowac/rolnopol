const notificationCenter = require("../modules/notification-center");
const { logDebug } = require("../helpers/logger-api");

async function publishNotificationEvent(event, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const action = safeOptions.action || "notification_publish";
  const meta = safeOptions.meta && typeof safeOptions.meta === "object" ? safeOptions.meta : {};

  try {
    const result = await notificationCenter.publish(event, {
      source: event?.source || "rolnopol-app",
    });

    return result?.accepted === true;
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
