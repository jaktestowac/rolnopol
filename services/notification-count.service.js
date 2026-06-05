// Service to count recent notifications emitted by the notification center
// This implementation assumes the existence of a helper that can retrieve recent notifications.
// If the notification store uses a different API, adjust accordingly.

const { getRecentNotifications } = require("../helpers/notification-store"); // existing helper (may need to be created)

/**
 * Returns the number of notifications emitted in the last `windowSec` seconds.
 * @param {number} windowSec - Look‑back window in seconds (default 60).
 * @returns {Promise<number>} count of recent notifications
 */
async function getCount(windowSec = 60) {
  const since = Date.now() - windowSec * 1000;
  // `getRecentNotifications` should accept a filter object with a `since` timestamp.
  const recent = await getRecentNotifications({ since });
  return Array.isArray(recent) ? recent.length : 0;
}

module.exports = { getCount };
