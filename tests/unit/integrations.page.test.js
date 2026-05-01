import { beforeEach, describe, expect, it, vi } from "vitest";

const INTEGRATIONS_PAGE_PATH = "../../public/js/pages/integrations.js";

function loadIntegrationsPageModule() {
  delete require.cache[require.resolve(INTEGRATIONS_PAGE_PATH)];
  return require(INTEGRATIONS_PAGE_PATH);
}

function createElement() {
  const attributes = {};
  const element = {
    style: { display: "" },
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    className: "",
    hidden: false,
    dataset: {},
    focus: vi.fn(),
    addEventListener: vi.fn(),
    classList: {
      toggle: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
    },
    setAttribute: vi.fn((name, value) => {
      attributes[name] = String(value);
    }),
    getAttribute: vi.fn((name) => attributes[name]),
    removeAttribute: vi.fn((name) => {
      delete attributes[name];
    }),
  };

  return element;
}

describe("IntegrationsPage personal API key feature gating", () => {
  beforeEach(() => {
    const integrationsTabPersonalApiKeys = createElement();
    integrationsTabPersonalApiKeys.dataset = { integrationsTab: "personal-api-keys" };

    const integrationsTabWebhooks = createElement();
    integrationsTabWebhooks.dataset = { integrationsTab: "webhooks" };

    const integrationsPanelPersonalApiKeys = createElement();
    integrationsPanelPersonalApiKeys.dataset = { integrationsPanel: "personal-api-keys" };

    const integrationsPanelWebhooks = createElement();
    integrationsPanelWebhooks.dataset = { integrationsPanel: "webhooks" };

    const elementMap = new Map([
      ["loadingMessage", createElement()],
      ["errorMessage", createElement()],
      ["errorText", createElement()],
      ["integrationsContent", createElement()],
      ["personalApiKeysSection", createElement()],
      ["personalApiKeyMessage", createElement()],
      ["personalApiKeyList", createElement()],
      ["personalApiKeyListState", createElement()],
      ["personalApiKeyModal", createElement()],
      ["personalApiKeyModalValue", createElement()],
      ["personalApiKeyHelpModal", createElement()],
      ["personalApiKeyLabel", createElement()],
      ["personalApiKeyExpiration", createElement()],
      ["personalApiKeyForm", createElement()],
      ["copyPersonalApiKeyBtn", createElement()],
      ["openPersonalApiKeyHelpModal", createElement()],
      ["closePersonalApiKeyModal", createElement()],
      ["dismissPersonalApiKeyModal", createElement()],
      ["closePersonalApiKeyHelpModal", createElement()],
      ["dismissPersonalApiKeyHelpModal", createElement()],
      ["createPersonalApiKeyBtn", createElement()],
      ["integrationsTabPersonalApiKeys", integrationsTabPersonalApiKeys],
      ["integrationsTabWebhooks", integrationsTabWebhooks],
      ["integrationsPanelPersonalApiKeys", integrationsPanelPersonalApiKeys],
      ["integrationsPanelWebhooks", integrationsPanelWebhooks],
    ]);

    const tabButtons = [integrationsTabPersonalApiKeys, integrationsTabWebhooks];
    const tabPanels = [integrationsPanelPersonalApiKeys, integrationsPanelWebhooks];

    global.window = {
      showNotification: vi.fn(),
      location: {
        href: "",
        hash: "",
        replace: vi.fn(),
      },
    };

    global.document = {
      getElementById: vi.fn((id) => elementMap.get(id) || null),
      addEventListener: vi.fn(),
      querySelectorAll: vi.fn((selector) => {
        if (selector === "[data-integrations-tab]") {
          return tabButtons;
        }

        if (selector === "[data-integrations-panel]") {
          return tabPanels;
        }

        return [];
      }),
    };

    Object.defineProperty(global, "navigator", {
      value: {
        clipboard: {
          writeText: vi.fn(async () => {}),
        },
      },
      configurable: true,
    });

    global.__integrationsTestElements = elementMap;
    global.__integrationsTestTabButtons = tabButtons;
    global.__integrationsTestTabPanels = tabPanels;
    global.__IntegrationsPage = loadIntegrationsPageModule();
  });

  it("redirects to 404 when the feature flag is disabled", async () => {
    const page = new global.__IntegrationsPage();
    const app = {
      getModule: vi.fn((name) => {
        if (name === "authService") {
          return {
            waitForAuth: vi.fn(async () => true),
            requireAuth: vi.fn(() => true),
          };
        }
        if (name === "apiService") {
          return { get: vi.fn() };
        }
        if (name === "featureFlagsService") {
          return { isEnabled: vi.fn(async () => false) };
        }
        return null;
      }),
    };

    await page.init(app);

    expect(window.location.replace).toHaveBeenCalledWith("/404.html");
  });

  it("loads personal API keys when the feature flag is enabled", async () => {
    const getSpy = vi.fn(async () => ({ success: true, data: { data: { items: [] } } }));
    const flagSpy = vi.fn(async (flagKey) => flagKey !== "integrationsWebhooksEnabled");
    const page = new global.__IntegrationsPage();
    const app = {
      getModule: vi.fn((name) => {
        if (name === "authService") {
          return {
            waitForAuth: vi.fn(async () => true),
            requireAuth: vi.fn(() => true),
          };
        }
        if (name === "apiService") {
          return { get: getSpy };
        }
        if (name === "featureFlagsService") {
          return { isEnabled: flagSpy };
        }
        return null;
      }),
    };

    await page.init(app);

    expect(flagSpy).toHaveBeenCalledWith("personalApiKeysEnabled", false);
    expect(flagSpy).toHaveBeenCalledWith("integrationsWebhooksEnabled", false);
    expect(getSpy).toHaveBeenCalledWith("users/profile/api-keys", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    expect(global.__integrationsTestElements.get("integrationsContent").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("none");
  });

  it("opens the integrations page when only webhooks are enabled", async () => {
    const getSpy = vi.fn();
    const flagSpy = vi.fn(async (flagKey) => flagKey !== "personalApiKeysEnabled");
    const page = new global.__IntegrationsPage();
    const app = {
      getModule: vi.fn((name) => {
        if (name === "authService") {
          return {
            waitForAuth: vi.fn(async () => true),
            requireAuth: vi.fn(() => true),
          };
        }
        if (name === "apiService") {
          return { get: getSpy };
        }
        if (name === "featureFlagsService") {
          return { isEnabled: flagSpy };
        }
        return null;
      }),
    };

    await page.init(app);

    expect(flagSpy).toHaveBeenCalledWith("personalApiKeysEnabled", false);
    expect(flagSpy).toHaveBeenCalledWith("integrationsWebhooksEnabled", false);
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(global.__integrationsTestElements.get("integrationsContent").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("none");
  });

  it("submits the selected personal API key expiration when creating a key", async () => {
    const page = new global.__IntegrationsPage();
    const labelInput = global.__integrationsTestElements.get("personalApiKeyLabel");
    const expirationSelect = global.__integrationsTestElements.get("personalApiKeyExpiration");
    const button = global.__integrationsTestElements.get("createPersonalApiKeyBtn");

    labelInput.value = "Weather sync";
    expirationSelect.value = "30d";
    button.innerHTML = '<i class="fas fa-plus"></i> Create API Key';

    page.apiService = {
      post: vi.fn(async () => ({ success: true, data: { data: { rawKey: "rpk_live_test" } } })),
    };
    page._getSelectedPersonalApiKeyScopes = vi.fn(() => ["user-account"]);
    page._revealPersonalApiKey = vi.fn();
    page._showPersonalApiKeyMessage = vi.fn();
    page._loadPersonalApiKeys = vi.fn();

    await page._handleCreatePersonalApiKey();

    expect(page.apiService.post).toHaveBeenCalledWith(
      "users/profile/api-keys",
      {
        label: "Weather sync",
        scopes: ["user-account"],
        expiration: "30d",
      },
      { requiresAuth: true, suppressErrorEvents: true },
    );
    expect(expirationSelect.value).toBe("never");
  });

  it("keeps the webhooks tab hidden when its feature flag is disabled", () => {
    const page = new global.__IntegrationsPage();

    page.webhooksEnabled = false;
    page._activateIntegrationsTab("webhooks");

    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").hidden).toBe(false);
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").hidden).toBe(true);
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("none");
  });

  it("switches to the webhooks placeholder tab", () => {
    const page = new global.__IntegrationsPage();
    page.webhooksEnabled = true;

    page._activateIntegrationsTab("webhooks");

    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").hidden).toBe(true);
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("none");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").hidden).toBe(false);
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsTabWebhooks").setAttribute).toHaveBeenCalledWith("aria-selected", "true");
  });
});
