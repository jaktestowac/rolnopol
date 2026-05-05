import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_PAGE_PATH = "../../public/js/pages/profile.js";

function loadProfilePageModule() {
  delete require.cache[require.resolve(PROFILE_PAGE_PATH)];
  return require(PROFILE_PAGE_PATH);
}

function createElement() {
  return {
    style: { display: "" },
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    className: "",
    focus: vi.fn(),
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
});
