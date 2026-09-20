/**
 * Error normalisation and masking (PRD §7.2, §15).
 *
 * Two jobs, and the second one is the security-relevant one:
 *
 *   1. Every error that reaches a client carries `extensions.code`, so a test or
 *      a UI can branch on a stable string instead of on message text.
 *   2. An error we did NOT anticipate is masked. Its message is replaced, its
 *      stack never leaves the process, and a correlation id is issued so the log
 *      line and the response can be tied together. `INTERNAL_ERROR` is therefore
 *      always deliberate: an unmasked message means someone chose it.
 *
 * Resolver errors arrive wrapped by `graphql-js` in a `GraphQLError` whose
 * `originalError` is what the resolver threw — that is where a domain code is
 * looked for.
 */
const { logError } = require("../../helpers/logger-api");

const CODES = {
  PARSE_FAILED: "GRAPHQL_PARSE_FAILED",
  VALIDATION_FAILED: "GRAPHQL_VALIDATION_FAILED",
  INTERNAL: "INTERNAL_ERROR",
};

const MASKED_MESSAGE = "An unexpected error occurred while resolving this field.";

let counter = 0;

/**
 * Correlation ids are derived from a process-local counter plus the pid rather
 * than from randomness, so they stay reproducible under test and still unique
 * across concurrent requests.
 */
function nextCorrelationId() {
  counter += 1;
  return `crew-${process.pid}-${counter}`;
}

/** True when the thrown error deliberately declared its own public code. */
function declaredCodeOf(error) {
  const original = error?.originalError;
  const fromExtensions = error?.extensions?.code;
  const fromOriginal = original?.extensions?.code || original?.code;
  const code = fromExtensions || fromOriginal;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Format one error for the wire.
 *
 * @param {import("graphql").GraphQLError} error
 * @param {object} [options]
 * @param {string} [options.defaultCode] - code for errors with none of their own
 * @param {boolean} [options.mask] - mask undeclared errors (default true)
 */
function formatError(error, options = {}) {
  const { defaultCode = null, mask = true } = options;
  const declared = declaredCodeOf(error);

  const base = {
    message: error.message,
    ...(error.locations ? { locations: error.locations } : {}),
    ...(error.path ? { path: error.path } : {}),
  };

  if (declared) {
    return { ...base, extensions: { ...(error.extensions || {}), code: declared } };
  }

  if (defaultCode) {
    // Parse and validation errors: `graphql-js` wrote the message, and it is
    // both safe and useful — it names the unknown field or the bad variable.
    return { ...base, extensions: { ...(error.extensions || {}), code: defaultCode } };
  }

  if (!mask) {
    return { ...base, extensions: { ...(error.extensions || {}), code: CODES.INTERNAL } };
  }

  // Unanticipated. Log everything, return almost nothing.
  const correlationId = nextCorrelationId();
  const original = error.originalError || error;
  logError("[crew-graphql] unexpected resolver error", {
    correlationId,
    path: error.path,
    error: original instanceof Error ? original.stack || original.message : String(original),
  });

  return {
    message: MASKED_MESSAGE,
    ...(error.locations ? { locations: error.locations } : {}),
    ...(error.path ? { path: error.path } : {}),
    extensions: { code: CODES.INTERNAL, correlationId },
  };
}

/** Format a list of errors, dropping nothing. */
function formatErrors(errors, options = {}) {
  return (errors || []).map((error) => formatError(error, options));
}

module.exports = { CODES, MASKED_MESSAGE, formatError, formatErrors, nextCorrelationId };
