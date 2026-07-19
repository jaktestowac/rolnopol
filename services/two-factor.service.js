const UserDataSingleton = require("../data/user-data-singleton");
const TwoFactorAuthDatabase = require("../data/two-factor-auth-database");
const userLifecycle = require("../data/user-lifecycle");
const featureFlagsService = require("./feature-flags.service");
const { logDebug, logError } = require("../helpers/logger-api");
const { toPublicUser } = require("../helpers/public-user");
const {
  DEFAULT_ISSUER,
  buildOtpAuthUrl,
  buildOtpQrCodeDataUrl,
  generateTwoFactorSecret,
  verifyTotpToken,
} = require("../helpers/two-factor-auth");

class TwoFactorService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
    this.twoFactorAuthDatabase = new TwoFactorAuthDatabase();

    userLifecycle.onUserDeleted("two-factor-auth:cleanup", async (user) => {
      try {
        await this.twoFactorAuthDatabase.deleteRecordByUserId(user.id);
        logDebug("Deleted two-factor auth record for deleted user", { userId: user.id });
      } catch (error) {
        logError("Failed to delete two-factor auth record during user cleanup", { userId: user.id, error });
        throw error;
      }
    });
  }

  _createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  _normalizeCode(code) {
    return String(code || "")
      .replace(/\s+/g, "")
      .trim();
  }

  _validateCode(code) {
    if (!/^\d{6}$/.test(code)) {
      throw this._createError("Validation failed: Two-factor code must be 6 digits", 400);
    }
  }

  _normalizeRecord(record) {
    const raw = record && typeof record === "object" ? record : {};

    return {
      enabled: raw.enabled === true,
      secret: typeof raw.secret === "string" && raw.secret.trim().length > 0 ? raw.secret.trim() : null,
      pendingSecret: typeof raw.pendingSecret === "string" && raw.pendingSecret.trim().length > 0 ? raw.pendingSecret.trim() : null,
      enabledAt: typeof raw.enabledAt === "string" ? raw.enabledAt : null,
      setupGeneratedAt: typeof raw.setupGeneratedAt === "string" ? raw.setupGeneratedAt : null,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  }

  async _getTwoFactorRecordForUser(user) {
    const userId = user?.id;
    const legacyRecord = user?.twoFactorAuth && typeof user.twoFactorAuth === "object" ? user.twoFactorAuth : null;

    let record = await this.twoFactorAuthDatabase.findByUserId(userId);
    if (!record && legacyRecord) {
      record = legacyRecord;
      try {
        await this.twoFactorAuthDatabase.setRecordForUser(userId, legacyRecord);
        await this.userDataInstance.updateUser(userId, { twoFactorAuth: null });
      } catch (error) {
        logError("Failed to migrate legacy two-factor auth record", { userId, error });
      }
    }

    return this._normalizeRecord(record);
  }

  async _getActiveUserOrThrow(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw this._createError("User not found", 404);
    }

    if (!user.isActive) {
      throw this._createError("Account is deactivated", 401);
    }

    return user;
  }

  async _buildConfiguration(user, record = null) {
    const normalizedRecord = record || (await this._getTwoFactorRecordForUser(user));
    const manualEntryKey = !normalizedRecord.enabled && normalizedRecord.pendingSecret ? normalizedRecord.pendingSecret : null;
    const accountLabel = user?.email || user?.displayedName || `user-${user?.id || "account"}`;
    const otpAuthUrl = manualEntryKey
      ? buildOtpAuthUrl({
          secret: manualEntryKey,
          issuer: DEFAULT_ISSUER,
          accountLabel,
        })
      : null;

    return {
      enabled: normalizedRecord.enabled,
      pendingSetup: !normalizedRecord.enabled && !!normalizedRecord.pendingSecret,
      enabledAt: normalizedRecord.enabledAt,
      setupGeneratedAt: normalizedRecord.setupGeneratedAt,
      issuer: DEFAULT_ISSUER,
      accountLabel,
      manualEntryKey,
      otpAuthUrl,
      qrCodeDataUrl: otpAuthUrl
        ? await buildOtpQrCodeDataUrl({
            secret: manualEntryKey,
            issuer: DEFAULT_ISSUER,
            accountLabel,
          })
        : null,
    };
  }

  async getConfiguration(userId) {
    const user = await this._getActiveUserOrThrow(userId);
    return await this._buildConfiguration(user);
  }

  async startSetup(userId) {
    const user = await this._getActiveUserOrThrow(userId);
    const current = await this._getTwoFactorRecordForUser(user);

    if (current.enabled) {
      throw this._createError("Two-factor authentication is already enabled", 409);
    }

    const now = new Date().toISOString();
    const nextRecord = {
      enabled: false,
      secret: null,
      pendingSecret: generateTwoFactorSecret(),
      enabledAt: null,
      setupGeneratedAt: now,
      updatedAt: now,
    };

    const savedRecord = await this.twoFactorAuthDatabase.setRecordForUser(user.id, nextRecord);

    logDebug("Two-factor setup generated", { userId: user.id });

    return await this._buildConfiguration(user, savedRecord);
  }

  async enable(userId, code) {
    const normalizedCode = this._normalizeCode(code);
    this._validateCode(normalizedCode);

    const user = await this._getActiveUserOrThrow(userId);
    const current = await this._getTwoFactorRecordForUser(user);

    if (current.enabled) {
      throw this._createError("Two-factor authentication is already enabled", 409);
    }

    if (!current.pendingSecret) {
      throw this._createError("Two-factor setup has not been started", 409);
    }

    if (!verifyTotpToken(current.pendingSecret, normalizedCode, { window: 1 })) {
      throw this._createError("Invalid two-factor authentication code", 400);
    }

    const now = new Date().toISOString();
    const nextRecord = {
      enabled: true,
      secret: current.pendingSecret,
      pendingSecret: null,
      enabledAt: now,
      setupGeneratedAt: current.setupGeneratedAt || now,
      updatedAt: now,
    };

    const savedRecord = await this.twoFactorAuthDatabase.setRecordForUser(user.id, nextRecord);

    logDebug("Two-factor authentication enabled", { userId: user.id });

    return await this._buildConfiguration(user, savedRecord);
  }

  async disable(userId, code) {
    const normalizedCode = this._normalizeCode(code);
    this._validateCode(normalizedCode);

    const user = await this._getActiveUserOrThrow(userId);
    const current = await this._getTwoFactorRecordForUser(user);

    if (!current.enabled || !current.secret) {
      throw this._createError("Two-factor authentication is not enabled", 409);
    }

    if (!verifyTotpToken(current.secret, normalizedCode, { window: 1 })) {
      throw this._createError("Invalid two-factor authentication code", 400);
    }

    const now = new Date().toISOString();
    const nextRecord = {
      enabled: false,
      secret: null,
      pendingSecret: null,
      enabledAt: null,
      setupGeneratedAt: null,
      updatedAt: now,
    };

    const savedRecord = await this.twoFactorAuthDatabase.setRecordForUser(user.id, nextRecord);

    logDebug("Two-factor authentication disabled", { userId: user.id });

    return await this._buildConfiguration(user, savedRecord);
  }

  async isLoginVerificationRequired(user) {
    if (!user) {
      return false;
    }

    try {
      const data = await featureFlagsService.getFeatureFlags();
      const globallyEnabled = data?.flags?.twoFactorAuthEnabled === true;

      if (!globallyEnabled) {
        return false;
      }

      const current = await this._getTwoFactorRecordForUser(user);
      return current.enabled === true && typeof current.secret === "string" && current.secret.length > 0;
    } catch (error) {
      logError("Two-factor feature check failed", { error });
      return false;
    }
  }

  async verifyLoginCode(user, code) {
    const normalizedCode = this._normalizeCode(code);
    if (!/^\d{6}$/.test(normalizedCode)) {
      return false;
    }

    const current = await this._getTwoFactorRecordForUser(user);
    if (!current.enabled || !current.secret) {
      return false;
    }

    return verifyTotpToken(current.secret, normalizedCode, { window: 1 });
  }

  buildLoginChallenge(user) {
    return {
      twoFactorRequired: true,
      method: "authenticator-app",
      prompt: "Enter the 6-digit code from your authenticator app to finish logging in.",
      user: toPublicUser(user),
    };
  }
}

module.exports = new TwoFactorService();
