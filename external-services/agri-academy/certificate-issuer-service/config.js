/**
 * Config for the certificate-issuer REST service (:4351) — mint / verify / revoke.
 *
 * A leaf: holds no clients. Because paid exams are settled BEFORE the attempt, an
 * issued certificate is always `valid` — the issuer holds no payment state.
 */
const path = require("path");

const HOST = process.env.CERTIFICATE_ISSUER_HOST || "0.0.0.0";
const PORT =
  process.env.CERTIFICATE_ISSUER_PORT != null && process.env.CERTIFICATE_ISSUER_PORT !== ""
    ? Number(process.env.CERTIFICATE_ISSUER_PORT)
    : 4351;

const DB_PATH = process.env.CERTIFICATES_DB_PATH
  ? path.resolve(process.env.CERTIFICATES_DB_PATH)
  : path.join(__dirname, "data", "certificates.json");

// Certificate number prefix: AA-<year>-<seq padded to 6>.
const CERT_PREFIX = process.env.CERTIFICATE_PREFIX || "AA";
const DEFAULT_VALID_MONTHS = Number(process.env.CERTIFICATE_DEFAULT_VALID_MONTHS || 24);

module.exports = { HOST, PORT, DB_PATH, CERT_PREFIX, DEFAULT_VALID_MONTHS };
