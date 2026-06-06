const { getJarCounts } = require("../services/jar-counts.service");
const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");

/**
 * GET /api/v1/operator/jar-counts
 * Returns aggregated counts from multiple application resources for the Firefly Jar.
 *
 * Query params:
 *   windowSec - look-back window for notifications (default 60)
 *
 * Response:
 *   { success, timestamp, data: { resources: [{ id, count, color, label }], windowSec } }
 */
async function handle(req, res) {
  try {
    const windowSec = parseInt(req.query.windowSec, 10) || 60;
    const resources = await getJarCounts({ windowSec });
    res.json(formatResponseBody({ data: { resources, windowSec } }));
  } catch (error) {
    logError("Error fetching jar counts", { error });
    res.status(500).json(formatResponseBody({ error: "Failed to fetch jar counts" }));
  }
}

module.exports = { handle };
