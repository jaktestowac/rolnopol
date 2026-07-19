import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_PAGE_PATH = "../../public/js/pages/profile.js";

function loadProfilePageModule() {
  delete require.cache[require.resolve(PROFILE_PAGE_PATH)];
  return require(PROFILE_PAGE_PATH);
}

function createElement() {
  const classes = new Set();
  return {
    style: { display: "" },
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    className: "",
    src: "",
    files: [],
    focus: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    classList: {
      add: vi.fn((...tokens) => tokens.forEach((token) => classes.add(token))),
      remove: vi.fn((...tokens) => tokens.forEach((token) => classes.delete(token))),
      toggle: vi.fn((token, force) => {
        if (force === true) {
          classes.add(token);
          return true;
        }
        if (force === false) {
          classes.delete(token);
          return false;
        }
        if (classes.has(token)) {
          classes.delete(token);
          return false;
        }
        classes.add(token);
        return true;
      }),
      contains: vi.fn((token) => classes.has(token)),
    },
  };
}

describe("ProfilePage personal API key feature gating", () => {
  beforeEach(() => {
    const elementMap = new Map([
      ["personalApiKeysSection", createElement()],
      ["personalApiKeyMessage", createElement()],
      ["personalApiKeyList", createElement()],
      ["personalApiKeyListState", createElement()],
      ["personalApiKeyModal", createElement()],
      ["personalApiKeyModalValue", createElement()],
      ["personalApiKeyHelpModal", createElement()],
      ["personalApiKeyLabel", createElement()],
      ["personalApiKeyMode", createElement()],
      ["personalApiKeyExpiration", createElement()],
      ["createPersonalApiKeyBtn", createElement()],
      ["confirmAvatarUpload", createElement()],
      ["avatarUploadPreviewImage", createElement()],
      ["avatarUploadPreviewFallback", createElement()],
      ["avatarUploadPreviewTitle", createElement()],
      ["twoFactorProfileInfo", createElement()],
      ["twoFactorProfileStatus", createElement()],
    ]);

    global.window = {
      showNotification: vi.fn(),
    };

    global.document = {
      getElementById: vi.fn((id) => elementMap.get(id) || null),
      addEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => []),
    };

    global.errorLogger = {
      log: vi.fn(),
    };

    global.__profileTestElements = elementMap;

    global.__ProfilePage = loadProfilePageModule();
  });

  it("does not fetch personal API keys when the feature flag is disabled", async () => {
    const page = new global.__ProfilePage();
    page.featureFlagsService = {
      isEnabled: vi.fn(async () => false),
    };
    page.apiService = {
      get: vi.fn(),
    };

    await page._initPersonalApiKeys();

    expect(page.featureFlagsService.isEnabled).toHaveBeenCalledWith("personalApiKeysEnabled", false);
    expect(page.apiService.get).not.toHaveBeenCalled();
    expect(global.__profileTestElements.get("personalApiKeysSection").style.display).toBe("none");
  });

  it("loads personal API keys when the feature flag is enabled", async () => {
    const page = new global.__ProfilePage();
    page.featureFlagsService = {
      isEnabled: vi.fn(async () => true),
    };
    page.apiService = {
      get: vi.fn(async () => ({ success: true, data: { data: { items: [] } } })),
    };

    await page._initPersonalApiKeys();

    expect(page.featureFlagsService.isEnabled).toHaveBeenCalledWith("personalApiKeysEnabled", false);
    expect(page.apiService.get).toHaveBeenCalledWith("users/profile/api-keys", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
  });

  it("submits the selected personal API key expiration when creating a key", async () => {
    const page = new global.__ProfilePage();
    const labelInput = global.__profileTestElements.get("personalApiKeyLabel");
    const modeSelect = global.__profileTestElements.get("personalApiKeyMode");
    const expirationSelect = global.__profileTestElements.get("personalApiKeyExpiration");
    const button = global.__profileTestElements.get("createPersonalApiKeyBtn");

    labelInput.value = "Weather sync";
    modeSelect.value = "read";
    expirationSelect.value = "30d";
    button.innerHTML = '<i class="fas fa-plus"></i> Create API Key';

    page.apiService = {
      post: vi.fn(async () => ({ success: true, data: { data: { rawKey: "rpk_live_test" } } })),
    };
    page._getSelectedPersonalApiKeyScopes = vi.fn(() => ["user-account"]);
    page._getSelectedPersonalApiKeyMode = vi.fn(() => "read");
    page._revealPersonalApiKey = vi.fn();
    page._showPersonalApiKeyMessage = vi.fn();
    page._loadPersonalApiKeys = vi.fn();

    await page._handleCreatePersonalApiKey();

    expect(page.apiService.post).toHaveBeenCalledWith(
      "users/profile/api-keys",
      {
        label: "Weather sync",
        scopes: ["user-account"],
        mode: "read",
        expiration: "30d",
      },
      { requiresAuth: true, suppressErrorEvents: true },
    );
    expect(expirationSelect.value).toBe("never");
    expect(modeSelect.value).toBe("write");
  });

  it("rejects avatar files larger than 100 KB before upload", async () => {
    const page = new global.__ProfilePage();

    const result = await page._validateAvatarFile({
      name: "too-big.png",
      type: "image/png",
      size: 100 * 1024 + 1,
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain("100 KB");
  });

  it("accepts avatar files that pass size and dimension validation", async () => {
    const page = new global.__ProfilePage();
    page._measureAvatarFile = vi.fn(async () => ({ width: 256, height: 128 }));

    const result = await page._validateAvatarFile({
      name: "avatar.png",
      type: "image/png",
      size: 64 * 1024,
    });

    expect(result).toMatchObject({
      isValid: true,
      width: 256,
      height: 128,
    });
  });

  it("shows two-factor status on profile information when 2FA is enabled", () => {
    const page = new global.__ProfilePage();
    const infoItem = global.__profileTestElements.get("twoFactorProfileInfo");
    const statusValue = global.__profileTestElements.get("twoFactorProfileStatus");

    page._formatDate = vi.fn(() => "July 14, 2026, 10:15 PM");

    page._renderTwoFactorProfileInfo({
      enabled: true,
      enabledAt: "2026-07-14T20:15:00.000Z",
    });

    expect(infoItem.style.display).toBe("flex");
    expect(statusValue.textContent).toBe("Enabled since July 14, 2026, 10:15 PM");
  });

  it("keeps two-factor status hidden on profile information when 2FA is disabled", () => {
    const page = new global.__ProfilePage();
    const infoItem = global.__profileTestElements.get("twoFactorProfileInfo");

    page._renderTwoFactorProfileInfo({ enabled: false });

    expect(infoItem.style.display).toBe("none");
  });
});
