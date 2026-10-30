const crypto = require("crypto");
const settings = require("../data/settings");
const { logDebug } = require("../helpers/logger-api");

/**
 * Recognises synthetic monitoring traffic (e.g. a scheduled Playwright check)
 * and tags the request with `req.syntheticTraffic`, so logs, metrics and rate
 * limiters can tell it apart from real users.
 *
 * Two tiers:
 *   - `X-Synthetic-Test: true` -> "synthetic". The header is trivially spoofed,
 *     so it only labels the request and grants nothing.
 *   - `X-Synthetic-Token: <SYNTHETIC_TOKEN>` -> "synthetic_verified". The secret
 *     comes from the environment with no default; verified traffic skips the
 *     general API rate limiters (see api/limiters.js) and nothing else.
 *
 * A wrong token fails soft: the request is classed "synthetic" and carries on.
 * The outcome is echoed in `X-Synthetic-Traffic` / `X-Synthetic-Verified` so a
 * monitor can assert that it was recognised. Gated by the
 * `syntheticMonitoringEnabled` flag, synced in by the feature-flags service.
 */

const TRAFFIC = Object.freeze({
  USER: "user",
  SYNTHETIC: "synthetic",
  SYNTHETIC_VERIFIED: "synthetic_verified",
});

const TEST_HEADER = "x-synthetic-test";
const TOKEN_HEADER = "x-synthetic-token";

// Matches the flag default; the feature-flags service overwrites it at startup and on every change.
let enabled = true;

function setEnabled(value) {
  enabled = value === true;
}

function isEnabled() {
  return enabled;
}

function tokenMatches(provided, expected) {
  if (typeof provided !== "string" || !provided || !expected) {
    return false;
  }
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  // timingSafeEqual throws on unequal lengths
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Pure classification of one request's headers.
 * @returns {"user"|"synthetic"|"synthetic_verified"}
 */
function classifySyntheticTraffic({ testHeader, tokenHeader, configuredToken, isFeatureEnabled = true }) {
  if (!isFeatureEnabled) {
    return TRAFFIC.USER;
  }
  if (tokenMatches(tokenHeader, configuredToken)) {
    return TRAFFIC.SYNTHETIC_VERIFIED;
  }
  const declaresSynthetic = typeof testHeader === "string" && testHeader.trim().toLowerCase() === "true";
  // A token that does not verify still announces a monitor: fail soft to the unverified tier.
  const presentsToken = typeof tokenHeader === "string" && tokenHeader.length > 0;
  if (declaresSynthetic || presentsToken) {
    return TRAFFIC.SYNTHETIC;
  }
  return TRAFFIC.USER;
}

/** `skip` predicate for the general API rate limiters: only a verified monitor is exempt. */
function isVerifiedSynthetic(req) {
  return req?.syntheticTraffic === TRAFFIC.SYNTHETIC_VERIFIED;
}

function syntheticTrafficMiddleware(req, res, next) {
  const tokenHeader = req.get(TOKEN_HEADER);
  const traffic = classifySyntheticTraffic({
    testHeader: req.get(TEST_HEADER),
    tokenHeader,
    configuredToken: settings.SYNTHETIC_TOKEN,
    isFeatureEnabled: enabled,
  });

  req.syntheticTraffic = traffic;

  if (traffic !== TRAFFIC.USER) {
    res.setHeader("X-Synthetic-Traffic", traffic);
    res.setHeader("X-Synthetic-Verified", String(traffic === TRAFFIC.SYNTHETIC_VERIFIED));
  }

  if (enabled && tokenHeader && traffic !== TRAFFIC.SYNTHETIC_VERIFIED) {
    logDebug("Synthetic token did not verify; request treated as unverified synthetic traffic", {
      method: req.method,
      path: req.path,
      tokenConfigured: Boolean(settings.SYNTHETIC_TOKEN),
    });
  }

  next();
}

module.exports = syntheticTrafficMiddleware;
module.exports.TRAFFIC = TRAFFIC;
module.exports.classifySyntheticTraffic = classifySyntheticTraffic;
module.exports.isVerifiedSynthetic = isVerifiedSynthetic;
module.exports.setEnabled = setEnabled;
module.exports.isEnabled = isEnabled;
