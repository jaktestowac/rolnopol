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
});
