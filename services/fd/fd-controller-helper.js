/**
 * Helper utilities for Farm Defence controllers.
 * Centralises service‑unavailable handling and generic try/catch wrapping.
 */
const { formatResponseBody } = require("../../helpers/response-helper");
const { logError } = require("../../helpers/logger-api");

/**
 * Returns a 503 Service Unavailable response – used when the FD service failed to load.
 */
function serviceUnavailable(res) {
  return res.status(503).json(formatResponseBody({ error: "Farm Defence service is currently unavailable" }));
}

/**
 * Executes an async function and maps errors to a uniform response shape.
 * @param {Function} fn Async function that returns the desired data.
 * @param {Function|null} errorStatusMapper Optional mapper that receives the error and returns an HTTP status code.
 * @returns {Promise<{data?:any, error?:string, status?:number}>}
 */
async function wrap(fn, errorStatusMapper = null) {
  try {
    const data = await fn();
    return { data };
  } catch (error) {
    // Log the full error for debugging purposes.
    logError("FarmDefenceController error:", error);
    const status = errorStatusMapper ? errorStatusMapper(error) : 500;
    return { error: error.message || "Unexpected error", status };
  }
}

module.exports = {
  serviceUnavailable,
  wrap,
};
