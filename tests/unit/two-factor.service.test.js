import twoFactorService from "../../services/two-factor.service.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const featureFlagsService = require("../../services/feature-flags.service.js");
const { generateTwoFactorSecret, generateTotpToken } = require("../../helpers/two-factor-auth");

describe("two-factor.service", () => {
  let userData;
  let tfaDb;

  beforeEach(() => {
    userData = twoFactorService.userDataInstance;
    tfaDb = twoFactorService.twoFactorAuthDatabase;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("_normalizeCode / _validateCode", () => {
    it("strips whitespace from a code", () => {
      expect(twoFactorService._normalizeCode("  12 34 56 ")).toBe("123456");
      expect(twoFactorService._normalizeCode(null)).toBe("");
    });

    it("rejects a non 6-digit code via enable", async () => {
      await expect(twoFactorService.enable(1, "12ab")).rejects.toMatchObject({
        message: expect.stringContaining("6 digits"),
        statusCode: 400,
      });
    });
  });

  describe("_normalizeRecord", () => {
    it("normalizes a partial record into a full shape", () => {
      const normalized = twoFactorService._normalizeRecord({ enabled: true, secret: "  ABC  ", pendingSecret: "" });
      expect(normalized).toEqual({
        enabled: true,
        secret: "ABC",
        pendingSecret: null,
        enabledAt: null,
        setupGeneratedAt: null,
        updatedAt: null,
      });
    });

    it("defaults an undefined record to a disabled record", () => {
      expect(twoFactorService._normalizeRecord(undefined)).toMatchObject({ enabled: false, secret: null });
    });
  });

  describe("getConfiguration", () => {
    it("throws 404 when the user is missing", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue(null);
      await expect(twoFactorService.getConfiguration(1)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("throws 401 when the account is deactivated", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: false });
      await expect(twoFactorService.getConfiguration(1)).rejects.toMatchObject({ statusCode: 401 });
    });

    it("reports a disabled, non-pending configuration when no record exists", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true, email: "a@b.io" });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue(null);

      const config = await twoFactorService.getConfiguration(1);
      expect(config).toMatchObject({ enabled: false, pendingSetup: false, manualEntryKey: null, otpAuthUrl: null, qrCodeDataUrl: null });
    });

    it("exposes manual entry key, otpauth url and QR code while a setup is pending", async () => {
      const secret = generateTwoFactorSecret();
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true, email: "a@b.io" });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, pendingSecret: secret, setupGeneratedAt: "2026-01-01T00:00:00.000Z" });

      const config = await twoFactorService.getConfiguration(1);
      expect(config.pendingSetup).toBe(true);
      expect(config.manualEntryKey).toBe(secret);
      expect(typeof config.otpAuthUrl).toBe("string");
      expect(config.otpAuthUrl).toContain("otpauth://");
      expect(config.qrCodeDataUrl).toMatch(/^data:image\//);
    });
  });

  describe("startSetup", () => {
    it("rejects when 2FA is already enabled", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: true, secret: "SECRET" });
      await expect(twoFactorService.startSetup(1)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("generates a pending secret and persists it", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true, email: "a@b.io" });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue(null);
      const saveSpy = vi.spyOn(tfaDb, "setRecordForUser").mockImplementation(async (_id, record) => record);

      const config = await twoFactorService.startSetup(1);
      expect(saveSpy).toHaveBeenCalled();
      const [, savedRecord] = saveSpy.mock.calls[0];
      expect(savedRecord.pendingSecret).toBeTruthy();
      expect(savedRecord.enabled).toBe(false);
      expect(config.pendingSetup).toBe(true);
    });
  });

  describe("enable", () => {
    it("rejects when already enabled", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: true, secret: "S" });
      await expect(twoFactorService.enable(1, "123456")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects when setup was never started", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, pendingSecret: null });
      await expect(twoFactorService.enable(1, "123456")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects an invalid TOTP code", async () => {
      const secret = generateTwoFactorSecret();
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, pendingSecret: secret });
      await expect(twoFactorService.enable(1, "000000")).rejects.toMatchObject({ statusCode: 400 });
    });

    it("enables 2FA when a valid TOTP code is supplied", async () => {
      const secret = generateTwoFactorSecret();
      const validToken = generateTotpToken(secret);
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true, email: "a@b.io" });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, pendingSecret: secret });
      const saveSpy = vi.spyOn(tfaDb, "setRecordForUser").mockImplementation(async (_id, record) => record);

      const config = await twoFactorService.enable(1, validToken);
      expect(config.enabled).toBe(true);
      const [, savedRecord] = saveSpy.mock.calls[0];
      expect(savedRecord).toMatchObject({ enabled: true, secret, pendingSecret: null });
    });
  });

  describe("disable", () => {
    it("rejects when 2FA is not enabled", async () => {
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, secret: null });
      await expect(twoFactorService.disable(1, "123456")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("disables 2FA when a valid TOTP code is supplied", async () => {
      const secret = generateTwoFactorSecret();
      const validToken = generateTotpToken(secret);
      vi.spyOn(userData, "findUser").mockResolvedValue({ id: 1, isActive: true, email: "a@b.io" });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: true, secret });
      const saveSpy = vi.spyOn(tfaDb, "setRecordForUser").mockImplementation(async (_id, record) => record);

      const config = await twoFactorService.disable(1, validToken);
      expect(config.enabled).toBe(false);
      const [, savedRecord] = saveSpy.mock.calls[0];
      expect(savedRecord).toMatchObject({ enabled: false, secret: null, pendingSecret: null });
    });
  });

  describe("isLoginVerificationRequired", () => {
    it("returns false for a null user", async () => {
      expect(await twoFactorService.isLoginVerificationRequired(null)).toBe(false);
    });

    it("returns false when the feature flag is globally disabled", async () => {
      vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: { twoFactorAuthEnabled: false } });
      expect(await twoFactorService.isLoginVerificationRequired({ id: 1 })).toBe(false);
    });

    it("returns true when globally enabled and the user has an enabled secret", async () => {
      vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({ flags: { twoFactorAuthEnabled: true } });
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: true, secret: generateTwoFactorSecret() });
      expect(await twoFactorService.isLoginVerificationRequired({ id: 1 })).toBe(true);
    });

    it("returns false and swallows errors from the feature flag lookup", async () => {
      vi.spyOn(featureFlagsService, "getFeatureFlags").mockRejectedValue(new Error("boom"));
      expect(await twoFactorService.isLoginVerificationRequired({ id: 1 })).toBe(false);
    });
  });

  describe("verifyLoginCode", () => {
    it("returns false for a malformed code without hitting the database", async () => {
      const spy = vi.spyOn(tfaDb, "findByUserId");
      expect(await twoFactorService.verifyLoginCode({ id: 1 }, "abc")).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns false when 2FA is not enabled", async () => {
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: false, secret: null });
      expect(await twoFactorService.verifyLoginCode({ id: 1 }, "123456")).toBe(false);
    });

    it("returns true for a valid TOTP code", async () => {
      const secret = generateTwoFactorSecret();
      vi.spyOn(tfaDb, "findByUserId").mockResolvedValue({ enabled: true, secret });
      expect(await twoFactorService.verifyLoginCode({ id: 1 }, generateTotpToken(secret))).toBe(true);
    });
  });

  describe("buildLoginChallenge", () => {
    it("returns a challenge with a password-free public user", () => {
      const challenge = twoFactorService.buildLoginChallenge({ id: 1, username: "u", password: "secret" });
      expect(challenge).toMatchObject({ twoFactorRequired: true, method: "authenticator-app" });
      expect(challenge.user).not.toHaveProperty("password");
    });
  });
});
