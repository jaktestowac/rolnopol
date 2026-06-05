/**
 * Helper to fetch recent notifications from the notification store.
 * This module provides a thin wrapper around the NotificationStore class
 * used by the notification‑center module. It creates its own instance
 * (pointing at the same JSON file) and filters events based on a `since`
 * timestamp (milliseconds since epoch).
 */

const NotificationStore = require("../modules/notification-center/store/notification-store");

/**
 * Retrieve notifications that occurred after the given timestamp.
 * @param {{since:number}} options - `since` is a Unix epoch ms value.
 * @returns {Promise<Array>} Array of notification objects.
 */
async function getRecentNotifications({ since }) {
  // Create a store instance without change listeners – safe for read‑only use.
  const store = new NotificationStore();
  // The underlying JSONDatabase exposes `getAll` which returns the full data object.
  const data = await store.db.getAll();
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  // Filter by createdAt timestamp (ISO string) or fallback to `createdAt` numeric.
  return notifications.filter((n) => {
    const ts = n.createdAt ? new Date(n.createdAt).getTime() : 0;
    return ts >= since;
  });
}

module.exports = { getRecentNotifications };
