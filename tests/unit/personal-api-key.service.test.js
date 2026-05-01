import { afterEach, describe, expect, it, vi } from "vitest";

const personalApiKeyService = require("../../services/personal-api-key.service");
const featureFlagsService = require("../../services/feature-flags.service");

function buildActiveKeyRecord(userId, index) {
  const timestamp = `2026-04-30T10:00:${String(index).padStart(2, "0")}.000Z`;

  return {
    id: `key-${index}`,
    userId,
    label: `Key ${index}`,
    scopes: ["user-account"],
    keyHash: `hash-${index}`,
    keyPreview: `rpk_live_pre...${index}`,
    keyPrefix: "rpk_live_pre",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null,
    regeneratedAt: null,
    revokedAt: null,
  };
}

describe("personal-api-key.service", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves required scopes for API key protected routes", () => {
    expect(personalApiKeyService.resolveRequiredScope({ originalUrl: "/api/v1/users/profile/api-keys" })).toBe("session-only");
    expect(personalApiKeyService.resolveRequiredScope({ originalUrl: "/api/v1/users/profile?tab=overview" })).toBe("user-account");
    expect(personalApiKeyService.resolveRequiredScope({ originalUrl: "/api/v1/staff?limit=10" })).toBe("staff");
    expect(personalApiKeyService.resolveRequiredScope({ baseUrl: "/api/v1", path: "/assistant-chat" })).toBe("chatbot");
    expect(personalApiKeyService.resolveRequiredScope({ baseUrl: "/api/v1", path: "/custom-resource" })).toBe("all");
    expect(personalApiKeyService.isScopeAllowed(["all"], "session-only")).toBe(false);
  });

  it("creates keys with a default label and normalized aliased scopes", async () => {
    vi.spyOn(personalApiKeyService.userDataInstance, "findUser").mockResolvedValue({
      id: 77,
      isActive: true,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: [],
      updatedAt: null,
    });

    let persistedStore = null;
    vi.spyOn(personalApiKeyService.db, "update").mockImplementation(async (updater) => {
      persistedStore = updater({
        version: 1,
        keys: [],
        updatedAt: null,
      });

      return persistedStore;
    });

    const result = await personalApiKeyService.createKey(77, {
      label: "   ",
      scopes: [" user ", "assistant", "user_account", "   "],
    });

    expect(result.rawKey).toMatch(/^rpk_live_/);
    expect(result.key.label).toBe("Personal integration key");
    expect(result.key.scopes).toEqual(["user-account", "chatbot"]);
    expect(result.key).not.toHaveProperty("keyHash");
    expect(persistedStore.keys).toHaveLength(1);
    expect(persistedStore.keys[0]).toEqual(
      expect.objectContaining({
        userId: 77,
        label: "Personal integration key",
        scopes: ["user-account", "chatbot"],
      }),
    );
  });

  it("creates keys with the selected expiration window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));

    vi.spyOn(personalApiKeyService.userDataInstance, "findUser").mockResolvedValue({
      id: 77,
      isActive: true,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: [],
      updatedAt: null,
    });

    let persistedStore = null;
    vi.spyOn(personalApiKeyService.db, "update").mockImplementation(async (updater) => {
      persistedStore = updater({
        version: 1,
        keys: [],
        updatedAt: null,
      });

      return persistedStore;
    });

    const result = await personalApiKeyService.createKey(77, {
      label: "Short-lived integration",
      scopes: ["user-account"],
      expiration: "14d",
    });

    expect(result.key.expiration).toBe("14d");
    expect(result.key.expiresAt).toBe("2026-05-14T12:00:00.000Z");
    expect(result.key.isExpired).toBe(false);
    expect(persistedStore.keys[0]).toEqual(
      expect.objectContaining({
        expiration: "14d",
        expiresAt: "2026-05-14T12:00:00.000Z",
      }),
    );
  });

  it("rejects unsupported expiration options", async () => {
    vi.spyOn(personalApiKeyService.userDataInstance, "findUser").mockResolvedValue({
      id: 55,
      isActive: true,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: [],
      updatedAt: null,
    });

    await expect(
      personalApiKeyService.createKey(55, {
        label: "Bad expiry",
        scopes: ["user-account"],
        expiration: "2h",
      }),
    ).rejects.toThrow("unsupported expiration");
  });

  it("rejects creation when the user already has the maximum number of active keys", async () => {
    vi.spyOn(personalApiKeyService.userDataInstance, "findUser").mockResolvedValue({
      id: 15,
      isActive: true,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: Array.from({ length: 20 }, (_, index) => buildActiveKeyRecord(15, index + 1)),
      updatedAt: null,
    });

    await expect(
      personalApiKeyService.createKey(15, {
        label: "One key too far",
        scopes: ["user-account"],
      }),
    ).rejects.toThrow("maximum of 20 active API keys reached");
  });

  it("rejects authentication when the personal API keys feature flag is disabled", async () => {
    const rawKey = personalApiKeyService._generateRawKey();
    const keyHash = personalApiKeyService._hashKey(rawKey);

    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: { personalApiKeysEnabled: false },
      updatedAt: null,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: [
        {
          id: "flag-disabled-key",
          userId: 44,
          label: "Disabled key",
          scopes: ["user-account"],
          keyHash,
          keyPreview: "rpk_live_dis...bled",
          keyPrefix: "rpk_live_dis",
          createdAt: "2026-04-30T10:00:00.000Z",
          updatedAt: "2026-04-30T10:00:00.000Z",
          lastUsedAt: null,
          regeneratedAt: null,
          revokedAt: null,
        },
      ],
      updatedAt: null,
    });

    const updateSpy = vi.spyOn(personalApiKeyService.db, "update");

    const result = await personalApiKeyService.authenticateApiKey(rawKey, {
      originalUrl: "/api/v1/users/profile",
    });

    expect(result).toEqual({ valid: false, reason: "feature_disabled" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects authentication for expired API keys", async () => {
    const rawKey = personalApiKeyService._generateRawKey();
    const keyHash = personalApiKeyService._hashKey(rawKey);

    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: { personalApiKeysEnabled: true },
      updatedAt: null,
    });
    vi.spyOn(personalApiKeyService.db, "getAll").mockResolvedValue({
      version: 1,
      keys: [
        {
          id: "expired-key",
          userId: 44,
          label: "Expired key",
          scopes: ["user-account"],
          expiration: "1d",
          expiresAt: "2026-04-29T09:00:00.000Z",
          keyHash,
          keyPreview: "rpk_live_exp...ired",
          keyPrefix: "rpk_live_exp",
          createdAt: "2026-04-28T09:00:00.000Z",
          updatedAt: "2026-04-28T09:00:00.000Z",
          lastUsedAt: null,
          regeneratedAt: null,
          revokedAt: null,
        },
      ],
      updatedAt: null,
    });

    const updateSpy = vi.spyOn(personalApiKeyService.db, "update");
    const findUserSpy = vi.spyOn(personalApiKeyService.userDataInstance, "findUser");

    const result = await personalApiKeyService.authenticateApiKey(rawKey, {
      originalUrl: "/api/v1/users/profile",
    });

    expect(result).toEqual(
      expect.objectContaining({
        valid: false,
        reason: "expired",
        apiKey: expect.objectContaining({
          id: "expired-key",
          isExpired: true,
          expiresAt: "2026-04-29T09:00:00.000Z",
        }),
      }),
    );
    expect(findUserSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
