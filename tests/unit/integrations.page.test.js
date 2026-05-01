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

    const webhookSubTabList = createElement();
    webhookSubTabList.dataset = { webhookSubtab: "list" };

    const webhookSubTabDeliveries = createElement();
    webhookSubTabDeliveries.dataset = { webhookSubtab: "deliveries" };

    const webhookSubPanelList = createElement();
    webhookSubPanelList.dataset = { webhookSubtabPanel: "list" };

    const webhookSubPanelDeliveries = createElement();
    webhookSubPanelDeliveries.dataset = { webhookSubtabPanel: "deliveries" };

    const webhookEventCheckboxOne = createElement();
    webhookEventCheckboxOne.value = "field.created";
    webhookEventCheckboxOne.checked = true;

    const webhookEventCheckboxTwo = createElement();
    webhookEventCheckboxTwo.value = "transaction.created";
    webhookEventCheckboxTwo.checked = false;

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
      ["webhookSubTabList", webhookSubTabList],
      ["webhookSubTabDeliveries", webhookSubTabDeliveries],
      ["webhookSubPanelList", webhookSubPanelList],
      ["webhookSubPanelDeliveries", webhookSubPanelDeliveries],
      ["webhooksSection", createElement()],
      ["webhookForm", createElement()],
      ["webhookName", createElement()],
      ["webhookUrl", createElement()],
      ["webhookEnabled", Object.assign(createElement(), { checked: true })],
      ["createWebhookBtn", createElement()],
      ["webhookMessage", createElement()],
      ["webhookEventsState", createElement()],
      ["webhookEventsOptions", createElement()],
      ["webhookListState", createElement()],
      ["webhookList", createElement()],
      ["webhookDeliveryListState", createElement()],
      ["webhookDeliveryList", createElement()],
    ]);

    const tabButtons = [integrationsTabPersonalApiKeys, integrationsTabWebhooks];
    const tabPanels = [integrationsPanelPersonalApiKeys, integrationsPanelWebhooks];
    const webhookSubTabButtons = [webhookSubTabList, webhookSubTabDeliveries];
    const webhookSubTabPanels = [webhookSubPanelList, webhookSubPanelDeliveries];

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

        if (selector === "[data-webhook-subtab]") {
          return webhookSubTabButtons;
        }

        if (selector === "[data-webhook-subtab-panel]") {
          return webhookSubTabPanels;
        }

        if (selector === "#webhookEventsOptions input[type='checkbox']") {
          return [webhookEventCheckboxOne, webhookEventCheckboxTwo];
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
    const getSpy = vi.fn(async (url) => {
      if (url === "users/profile/webhooks/events") {
        return {
          success: true,
          data: { data: { items: [{ type: "field.created", label: "Field Created", description: "A field was created." }] } },
        };
      }

      if (url === "users/profile/webhooks") {
        return { success: true, data: { data: { items: [] } } };
      }

      if (url === "users/profile/webhooks/deliveries?limit=10") {
        return { success: true, data: { data: { items: [] } } };
      }

      return { success: true, data: { data: { items: [] } } };
    });
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
    expect(getSpy).toHaveBeenCalledWith("users/profile/webhooks/events", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    expect(getSpy).toHaveBeenCalledWith("users/profile/webhooks", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    expect(getSpy).toHaveBeenCalledWith("users/profile/webhooks/deliveries?limit=10", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    expect(global.__integrationsTestElements.get("integrationsContent").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("none");
    expect(global.__integrationsTestElements.get("webhookSubPanelList").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("webhookSubPanelDeliveries").style.display).toBe("none");
  });

  it("submits the selected webhook configuration when creating a webhook", async () => {
    const page = new global.__IntegrationsPage();
    const nameInput = global.__integrationsTestElements.get("webhookName");
    const urlInput = global.__integrationsTestElements.get("webhookUrl");
    const enabledInput = global.__integrationsTestElements.get("webhookEnabled");
    const button = global.__integrationsTestElements.get("createWebhookBtn");

    nameInput.value = "Field sync";
    urlInput.value = "https://example.com/hooks/field-sync";
    enabledInput.checked = true;
    button.innerHTML = '<i class="fas fa-plus"></i> Create Webhook';

    page.apiService = {
      post: vi.fn(async () => ({ success: true, data: { data: { webhook: { id: 1 } } } })),
    };
    page._showWebhookMessage = vi.fn();
    page._loadWebhooks = vi.fn();
    page._loadWebhookDeliveries = vi.fn();

    await page._handleCreateWebhook();

    expect(page.apiService.post).toHaveBeenCalledWith(
      "users/profile/webhooks",
      {
        name: "Field sync",
        url: "https://example.com/hooks/field-sync",
        eventTypes: ["field.created"],
        enabled: true,
      },
      { requiresAuth: true, suppressErrorEvents: true },
    );
    expect(nameInput.value).toBe("");
    expect(urlInput.value).toBe("");
    expect(enabledInput.checked).toBe(true);
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

  it("renders disabled webhooks with a distinct badge", () => {
    const page = new global.__IntegrationsPage();
    const list = global.__integrationsTestElements.get("webhookList");

    page._formatOptionalDate = vi.fn(() => "Never");

    page._renderWebhooks([
      {
        id: 1,
        name: "Disabled sink",
        url: "https://example.com/webhook",
        eventTypes: ["field.created"],
        enabled: false,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null,
        lastDeliveredAt: null,
        lastFailureAt: null,
      },
    ]);

    expect(list.innerHTML).toContain("status-badge-modern--disabled");
    expect(list.innerHTML).toContain("Disabled");
  });

  it("switches to the webhooks tab", () => {
    const page = new global.__IntegrationsPage();
    page.webhooksEnabled = true;
    page._ensureWebhookDataLoaded = vi.fn();

    page._activateIntegrationsTab("webhooks");

    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").hidden).toBe(true);
    expect(global.__integrationsTestElements.get("integrationsPanelPersonalApiKeys").style.display).toBe("none");
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").hidden).toBe(false);
    expect(global.__integrationsTestElements.get("integrationsPanelWebhooks").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("integrationsTabWebhooks").setAttribute).toHaveBeenCalledWith("aria-selected", "true");
    expect(page._ensureWebhookDataLoaded).toHaveBeenCalled();
  });

  it("switches between webhook list and deliveries subtabs", () => {
    const page = new global.__IntegrationsPage();

    page._activateWebhookSubTab("deliveries");

    expect(global.__integrationsTestElements.get("webhookSubPanelList").hidden).toBe(true);
    expect(global.__integrationsTestElements.get("webhookSubPanelList").style.display).toBe("none");
    expect(global.__integrationsTestElements.get("webhookSubPanelDeliveries").hidden).toBe(false);
    expect(global.__integrationsTestElements.get("webhookSubPanelDeliveries").style.display).toBe("block");
    expect(global.__integrationsTestElements.get("webhookSubTabDeliveries").setAttribute).toHaveBeenCalledWith("aria-selected", "true");
  });
});
