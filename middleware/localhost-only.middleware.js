const { sendForbidden } = require("../helpers/response-helper");
const { logWarning } = require("../helpers/logger-api");

/**
 * The endpoint answers only to callers on this machine. Used by endpoints that
 * must never be reachable from another host — most notably
 * `GET /api/v1/shutdown`, which stops the whole application.
 *
 * Per request the check is: reject anything proxied, read the socket peer
 * address, match it against the rules. Two choices worth keeping:
 *
 *   - The address comes from the socket, not `req.ip`. `req.ip` honours
 *     `trust proxy`, so a future `app.set("trust proxy")` would silently make
 *     this gate spoofable via `X-Forwarded-For`.
 *   - A proxy-hop header is refused by default: the socket may be loopback (the
 *     proxy runs locally) while the real client is remote, and the header is
 *     client-controlled, so the two cases cannot be told apart.
 *
 * TO WIDEN THE GATE — env var (no code change, no restart), `allow` at the call
 * site, or a new entry in LOCAL_ADDRESS_RULES for every caller at once. A rule
 * is a string (exact, case-insensitive) or a RegExp tested against the
 * normalized address; see localhostOnly() for the full option list.
 */

/** Default rules: the loopback interface, in every form Node reports it. */
const LOCAL_ADDRESS_RULES = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 127.0.0.0/8, not just 127.0.0.1
  "::1",
  "0:0:0:0:0:0:0:1",
];

const PROXY_HOP_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"];
const DEFAULT_ENV_VAR = "LOCALHOST_ONLY_EXTRA_ADDRESSES";
const IPV4_MAPPED_PREFIX = "::ffff:"; // a v4 peer on a dual-stack socket

/**
 * Reduce an address to the form the rules are written against. Handles the
 * shapes Node hands out: bracketed literals, IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`), and zone indices (`fe80::1%eth0`).
 *
 * @param {unknown} address
 * @returns {string|null} normalized address, or null when there is nothing usable
 */
function normalizeAddress(address) {
  if (typeof address !== "string") return null;

  let value = address.trim().toLowerCase();
  if (value === "") return null;

  const zoneAt = value.indexOf("%");
  if (zoneAt !== -1) value = value.slice(0, zoneAt);

  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);

  if (value.startsWith(IPV4_MAPPED_PREFIX)) value = value.slice(IPV4_MAPPED_PREFIX.length);

  return value === "" ? null : value;
}

/** Test one rule against an already-normalized address. */
function ruleMatches(rule, address) {
  if (rule instanceof RegExp) return rule.test(address);
  if (typeof rule === "string") return normalizeAddress(rule) === address;

  return false;
}

/**
 * Read a comma-separated allowlist from the environment. Looked up on every
 * request, so the gate can be widened without a restart.
 */
function rulesFromEnv(envVar) {
  if (!envVar) return [];

  return String(process.env[envVar] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * @param {unknown} address
 * @param {Array<string|RegExp>} [extraRules] - merged with LOCAL_ADDRESS_RULES
 * @returns {boolean} true when the address is one this machine answers to
 */
function isLocalAddress(address, extraRules = []) {
  const value = normalizeAddress(address);
  if (value === null) return false;

  return [...LOCAL_ADDRESS_RULES, ...extraRules].some((rule) => ruleMatches(rule, value));
}

/** The raw socket peer address, ignoring proxy headers. */
function remoteAddressOf(req) {
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || null;
}

/** The first proxy-hop header present on the request, or null. */
function proxyHopHeaderOf(req) {
  const headers = req?.headers || {};

  return (
    PROXY_HOP_HEADERS.find((header) => {
      const value = headers[header];
      return typeof value === "string" && value.trim() !== "";
    }) || null
  );
}

/**
 * The gate itself, without the middleware wrapper — handy for a controller that
 * needs to branch on locality rather than reject outright.
 *
 * @param {import("express").Request} req
 * @param {Object} [options] - same `allow` / `allowProxyHopHeaders` / `envVar` as localhostOnly
 * @returns {boolean} true when the request came from this machine
 */
function isLocalRequest(req, options = {}) {
  const { allow = [], allowProxyHopHeaders = false, envVar = DEFAULT_ENV_VAR } = options;

  if (!allowProxyHopHeaders && proxyHopHeaderOf(req) !== null) return false;

  return isLocalAddress(remoteAddressOf(req), [...allow, ...rulesFromEnv(envVar)]);
}

/**
 * Localhost-only middleware factory. See the extension notes at the top of the file.
 *
 * @param {Object} [options]
 * @param {string} [options.resourceName] - label used in the log line and the 403 message
 * @param {Array<string|RegExp>} [options.allow] - extra addresses to permit
 * @param {boolean} [options.allowProxyHopHeaders] - accept proxied requests (default false)
 * @param {string|null} [options.envVar] - env var holding a comma-separated allowlist; null disables
 * @param {Function} [options.onDenied] - (req, res) => void, replaces the default 403
 * @returns {Function} Express middleware
 */
function localhostOnly(options = {}) {
  const { resourceName = "Endpoint", onDenied } = options;

  const deny = onDenied || ((req, res) => sendForbidden(req, res, `${resourceName} is available from localhost only`));

  return (req, res, next) => {
    if (isLocalRequest(req, options)) return next();

    logWarning(`${resourceName} refused: request did not originate from localhost`, {
      path: req.originalUrl,
      remoteAddress: remoteAddressOf(req),
      proxyHopHeader: proxyHopHeaderOf(req),
    });

    return deny(req, res);
  };
}

module.exports = {
  localhostOnly,
  isLocalRequest,
  isLocalAddress,
  LOCAL_ADDRESS_RULES,
  PROXY_HOP_HEADERS,
};
