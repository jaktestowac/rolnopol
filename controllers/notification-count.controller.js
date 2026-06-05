const { getCount } = require("../services/notification-count.service");
const { formatResponseBody } = require("../helpers/response-helper");

/**
 * GET /api/v1/notifications/count
 * Returns the number of notifications emitted in the recent time window.
 */
async function handle(req, res) {
  try {
    const windowSec = parseInt(req.query.windowSec, 10) || 60;
    const count = await getCount(windowSec);
    res.json(formatResponseBody({ data: { count, windowSec } }));
  } catch (error) {
    const { logError } = require("../helpers/logger-api");
    logError("Error fetching notification count", { error });
    res.status(500).json(formatResponseBody({ error: "Failed to fetch notification count" }));
  }
}

module.exports = { handle };
