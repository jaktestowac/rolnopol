/**
 * Structured error contract for the FarmStay bridge (routes/v1/farm-stay.route.js).
 *
 * Every error the *bridge itself* originates is emitted through one shape so the
 * page and API consumers can branch on a stable machine code instead of parsing
 * prose:
 *
 *   { error: <CODE>, code: <CODE>, message: <human>, ...domainFields }
 *
 *   - `error` and `code` are the SAME SCREAMING_SNAKE machine token (`error` is
 *     kept for backward compatibility with the existing page + tests, which read
 *     `body.error`; `code` is the forward-looking name).
 *   - `message` is a human-readable sentence.
 *   - domain fields (e.g. `needed`, `balance` on INSUFFICIENT_FUNDS) are spread at
 *     the top level so the page can read them without digging.
 *
 * Passthrough responses from the gateway/client keep their own shape (they are the
 * ecosystem's contract, not the bridge's); this module governs only what the bridge
 * mints locally. `wrapUpstream` is provided for the few places we want to normalise
 * an offline/unknown upstream body into the same envelope.
 */

const ERROR_CODES = Object.freeze({
  // Bridge-originated
  INTERNAL: "INTERNAL",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  FORBIDDEN: "FORBIDDEN",
  IDEMPOTENCY_IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS",
  // Upstream connectivity (surfaced by the app-side client)
  FARM_STAY_OFFLINE: "FARM_STAY_OFFLINE",
});

const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODES.INTERNAL]: "Internal error",
  [ERROR_CODES.INSUFFICIENT_FUNDS]: "Insufficient ROL balance for this booking",
  [ERROR_CODES.FORBIDDEN]: "You are not allowed to perform this action",
  [ERROR_CODES.IDEMPOTENCY_IN_PROGRESS]: "A request with this Idempotency-Key is already being processed",
  [ERROR_CODES.FARM_STAY_OFFLINE]: "FarmStay gateway offline",
});

/**
 * Build a consistent bridge error body.
 * @param {string} code    machine code (use ERROR_CODES.*)
 * @param {string} [message]  human message; defaults to a per-code sentence
 * @param {object} [fields]   extra domain fields spread at the top level
 */
function bridgeError(code, message, fields = {}) {
  return {
    error: code,
    code,
    message: message || DEFAULT_MESSAGES[code] || code,
    ...fields,
  };
}

/**
 * Send a bridge error response in the canonical envelope.
 * @returns the Express response (so callers can `return sendBridgeError(...)`).
 */
function sendBridgeError(res, status, code, message, fields) {
  return res.status(status).json(bridgeError(code, message, fields));
}

module.exports = { ERROR_CODES, DEFAULT_MESSAGES, bridgeError, sendBridgeError };
