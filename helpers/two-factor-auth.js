const OTPAuth = require("otpauth");
const QRCode = require("qrcode");

const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_ALGORITHM = "SHA1";
const DEFAULT_ISSUER = "Rolnopol";

function normalizeSecret(secret) {
  return OTPAuth.Secret.fromBase32(
    String(secret || "")
      .toUpperCase()
      .replace(/=+$/g, "")
      .replace(/\s+/g, ""),
  ).base32;
}

function createTotp(secret, options = {}) {
  return new OTPAuth.TOTP({
    issuer: String(options.issuer || DEFAULT_ISSUER).trim() || DEFAULT_ISSUER,
    label: String(options.accountLabel || "rolnopol-user").trim() || "rolnopol-user",
    algorithm: String(options.algorithm || DEFAULT_ALGORITHM).toUpperCase(),
    digits: Number.isInteger(options.digits) ? options.digits : DEFAULT_DIGITS,
    period: Number.isInteger(options.period) ? options.period : DEFAULT_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(normalizeSecret(secret)),
  });
}

function generateTwoFactorSecret(length = 20) {
  return new OTPAuth.Secret({ size: length }).base32;
}

function generateTotpToken(secret, options = {}) {
  const timestamp = Number.isFinite(options.timestamp) ? options.timestamp : Date.now();
  return createTotp(secret, options).generate({ timestamp });
}

function verifyTotpToken(secret, code, options = {}) {
  const normalizedCode = String(code || "")
    .replace(/\s+/g, "")
    .trim();
  const digits = Number.isInteger(options.digits) ? options.digits : DEFAULT_DIGITS;
  const windowSize = Number.isInteger(options.window) ? options.window : 1;
  const timestamp = Number.isFinite(options.timestamp) ? options.timestamp : Date.now();

  if (!new RegExp(`^\\d{${digits}}$`).test(normalizedCode)) {
    return false;
  }

  const delta = createTotp(secret, {
    ...options,
    digits,
  }).validate({
    token: normalizedCode,
    window: windowSize,
    timestamp,
  });

  return delta !== null;
}

function buildOtpAuthUrl(options = {}) {
  return createTotp(options.secret, options).toString();
}

async function buildOtpQrCodeDataUrl(options = {}) {
  const otpAuthUrl = buildOtpAuthUrl(options);

  return await QRCode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: Number.isInteger(options.width) ? options.width : 220,
    color: {
      dark: "#1F4D34FF",
      light: "#FFFFFFFF",
    },
  });
}

module.exports = {
  DEFAULT_ISSUER,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD_SECONDS,
  DEFAULT_ALGORITHM,
  generateTwoFactorSecret,
  generateTotpToken,
  verifyTotpToken,
  buildOtpAuthUrl,
  buildOtpQrCodeDataUrl,
};
