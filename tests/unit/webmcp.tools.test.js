import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SERVICE_PATH = "../../public/js/webmcp/webmcp-service.js";
const TOOL_PATHS = [
  "../../public/js/webmcp/tools/global-tools.js",
  "../../public/js/webmcp/tools/auth-tools.js",
  "../../public/js/webmcp/tools/farm-tools.js",
  "../../public/js/webmcp/tools/marketplace-tools.js",
  "../../public/js/webmcp/tools/finance-tools.js",
];

const PAGES = [
  "index",
  "login",
  "register",
  "staff-fields-main",
  "staff-fields-assign",
  "staff-fields-export",
  "marketplace",
  "financial",
  "financial-commodities",
  "weather",
  "alerts",
];

const ALL_FLAGS = {
  webMcpEnabled: true,
  webMcpDemoLoginEnabled: true,
  weatherPageEnabled: true,
  alertsEnabled: true,
  staffFieldsExportEnabled: true,
  financialCommoditiesEnabled: true,
  financialCommoditiesTradingEnabled: true,
  registrationStrongPasswordEnabled: false,
};

// Secrets must never become tool input (WebMCP spec: over-parameterisation).
const FORBIDDEN_INPUTS = /password|passwd|cvv|card|token|apikey|api_key|secret|twofactor|otp/i;

// Tools that move money/ownership or end the session must ask the user first.
const CONSEQUENTIAL_TOOLS = [
  "rolnopol.auth.logout",
  "rolnopol.marketplace.createOffer",
  "rolnopol.marketplace.cancelOffer",
  "rolnopol.marketplace.buyOffer",
  "rolnopol.finance.transfer",
  "rolnopol.commodities.trade",
];

// Tools whose output contains text written by other users.
const UNTRUSTED_TOOLS = ["rolnopol.marketplace.searchOffers", "rolnopol.finance.listTransactions"];

let WebMcp;

beforeAll(() => {
  WebMcp = require(SERVICE_PATH);
  TOOL_PATHS.forEach((toolPath) => require(toolPath));
});

function envelope(data) {
  return { success: true, status: 200, data: { success: true, data } };
}

function createModelContext() {
  const tools = new Map();
  return {
    tools,
    registerTool: vi.fn(async (tool, { signal } = {}) => {
      if (tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
      tools.set(tool.name, tool);
      signal?.addEventListener("abort", () => tools.delete(tool.name));
    }),
  };
}

/**
 * Build a service with a fake ApiService. `routes` maps "METHOD endpoint" to a
 * response or a function returning one.
 */
function createService({ page = "index", flags = ALL_FLAGS, authenticated = true, routes = {}, modules = {} } = {}) {
  const request = vi.fn(async (method, endpoint, options) => {
    const handler = routes[`${method} ${endpoint}`];
    if (endpoint === "feature-flags" && !handler) return envelope({ flags });
    if (!handler) return { success: false, status: 404, error: `No route for ${method} ${endpoint}` };
    return typeof handler === "function" ? handler(options) : handler;
  });

  const listeners = {};
  const eventBus = {
    on: vi.fn((event, callback) => {
      listeners[event] = callback;
    }),
    emit: (event, payload) => listeners[event]?.(payload),
  };

  const allModules = {
    apiService: { request },
    authService: { isAuthenticated: () => authenticated, logout: vi.fn(async () => {}), login: vi.fn() },
    ...modules,
  };

  const app = { getModule: (name) => allModules[name] || null, getEventBus: () => eventBus };
  const modelContext = createModelContext();
  const service = new WebMcp.WebMcpService({ app, page, modelContext, document: {} });

  return { service, modelContext, request, eventBus, modules: allModules };
}

async function startAndGet(options) {
  const setup = createService(options);
  await setup.service.start();
  return setup;
}

function run(modelContext, name, input) {
  const tool = modelContext.tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool.execute(input, {});
}

describe("WebMCP service", () => {
  it("prefers document.modelContext and falls back to navigator.modelContext", () => {
    const documentContext = { registerTool() {} };
    const navigatorContext = { registerTool() {} };

    expect(WebMcp.getModelContext({ document: { modelContext: documentContext }, navigator: { modelContext: navigatorContext } })).toBe(
      documentContext,
    );
    expect(WebMcp.getModelContext({ document: {}, navigator: { modelContext: navigatorContext } })).toBe(navigatorContext);
    expect(WebMcp.getModelContext({ document: {}, navigator: {} })).toBeNull();
  });

  it("registers nothing while webMcpEnabled is off", async () => {
    const { service, modelContext } = createService({ flags: { ...ALL_FLAGS, webMcpEnabled: false } });

    expect(await service.start()).toBe(false);
    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });

  it("registers prefixed tools with an abort signal and unregisters them on stop()", async () => {
    const { service, modelContext } = await startAndGet({ page: "marketplace" });

    expect(modelContext.tools.has("rolnopol.marketplace.buyOffer")).toBe(true);
    const [, options] = modelContext.registerTool.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);

    service.stop();
    expect(modelContext.tools.size).toBe(0);
  });

  it("re-registers tools when feature flags change", async () => {
    let flags = { ...ALL_FLAGS, weatherPageEnabled: false };
    const setup = createService({ routes: { "GET feature-flags": () => envelope({ flags }) } });
    await setup.service.start();
    expect(setup.modelContext.tools.has("rolnopol.weather.getForecast")).toBe(false);

    flags = { ...ALL_FLAGS, weatherPageEnabled: true };
    setup.eventBus.emit("feature-flags:changed");
    await vi.waitFor(() => expect(setup.modelContext.tools.has("rolnopol.weather.getForecast")).toBe(true));
  });

  it("calls the API without login redirects or global error events", async () => {
    const { service, request } = createService({ routes: { "GET fields": envelope([{ id: 1 }]) } });

    const result = await service.call("GET", "fields");

    expect(result).toEqual({ ok: true, data: [{ id: 1 }] });
    expect(request).toHaveBeenCalledWith("GET", "fields", expect.objectContaining({ noAuthRedirect: true, suppressErrorEvents: true }));
  });

  it("reports an expired session as not_authenticated", async () => {
    const { service } = createService({ routes: { "GET fields": { success: false, status: 401, error: "Unauthorized" } } });

    expect(await service.call("GET", "fields")).toEqual({ ok: false, status: 401, error: "not_authenticated" });
  });

  it("rejects invalid input before running the tool", async () => {
    const { modelContext, request } = await startAndGet({ page: "financial" });
    request.mockClear();

    const result = await run(modelContext, "rolnopol.finance.transfer", { toUserId: 2, amount: 5000, description: "x", extra: 1 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
    expect(result.details).toEqual(expect.arrayContaining(["input.amount must be <= 999.99", "input.extra is not allowed"]));
    expect(request).not.toHaveBeenCalled();
  });
});

describe("validateInput", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" },
      count: { type: "integer", minimum: 1 },
      price: { type: "number", exclusiveMinimum: 0 },
      kind: { type: "string", enum: ["a", "b"] },
      tags: { type: "array", maxItems: 1, items: { type: "string" } },
    },
    required: ["name"],
    additionalProperties: false,
  };

  it("accepts valid input", () => {
    expect(WebMcp.validateInput(schema, { name: "abc", count: 2, price: 0.5, kind: "a", tags: ["x"] })).toEqual([]);
  });

  it("reports every violation", () => {
    expect(WebMcp.validateInput(schema, { name: "ABCDEF", count: 1.5, price: 0, kind: "c", tags: ["x", 2], other: true })).toEqual([
      "input.name must be at most 4 characters",
      "input.name has an invalid format",
      "input.count must be an integer",
      "input.price must be > 0",
      "input.kind must be one of: a, b",
      "input.tags must have at most 1 items",
      "input.tags[1] must be a string",
      "input.other is not allowed",
    ]);
  });

  it("requires required properties", () => {
    expect(WebMcp.validateInput(schema, {})).toEqual(["input.name is required"]);
  });
});

describe("tool contracts", () => {
  const registrations = [];

  beforeAll(async () => {
    for (const page of PAGES) {
      for (const authenticated of [true, false]) {
        const { modelContext } = await startAndGet({ page, authenticated });
        registrations.push({ page, authenticated, tools: [...modelContext.tools.values()] });
      }
    }
  });

  const allTools = () => registrations.flatMap((registration) => registration.tools);

  it("registers tools on every page (the global group) and page tools only where they belong", () => {
    for (const { tools } of registrations) {
      expect(tools.some((tool) => tool.name === "rolnopol.auth.getStatus")).toBe(true);
    }

    const pagesWith = (name) =>
      [...new Set(registrations.filter((r) => r.tools.some((tool) => tool.name === name)).map((r) => r.page))].sort();

    expect(pagesWith("rolnopol.marketplace.buyOffer")).toEqual(["marketplace"]);
    expect(pagesWith("rolnopol.assignments.assign")).toEqual(["staff-fields-assign", "staff-fields-main"]);
    expect(pagesWith("rolnopol.export.download")).toEqual(["staff-fields-export"]);
    expect(pagesWith("rolnopol.auth.loginAsDemo")).toEqual(["login"]);
    expect(pagesWith("rolnopol.auth.prefillRegistration")).toEqual(["register"]);
  });

  it("splits tools by login state", () => {
    const index = (authenticated) => registrations.find((r) => r.page === "index" && r.authenticated === authenticated).tools.map((t) => t.name);

    expect(index(true)).toEqual(expect.arrayContaining(["rolnopol.farm.getOverview", "rolnopol.auth.logout"]));
    expect(index(true)).not.toContain("rolnopol.auth.openLogin");
    expect(index(false)).toContain("rolnopol.auth.openLogin");
    expect(index(false)).not.toContain("rolnopol.farm.getOverview");
  });

  it("uses valid names, non-empty descriptions and JSON-serialisable closed schemas", () => {
    for (const tool of allTools()) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.name.startsWith("rolnopol.")).toBe(true);
      expect(tool.title).toBeTruthy();
      expect(tool.description.trim().length).toBeGreaterThan(20);
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("never accepts secrets as input", () => {
    for (const tool of allTools()) {
      for (const property of Object.keys(tool.inputSchema.properties || {})) {
        expect(`${tool.name}.${property}`).not.toMatch(FORBIDDEN_INPUTS);
      }
    }
  });

  it("marks money, ownership and session changes as consequential", () => {
    const byName = new Map(allTools().map((tool) => [tool.name, tool]));

    for (const name of CONSEQUENTIAL_TOOLS) {
      expect(byName.get(name)?.annotations?.consequentialHint, name).toBe(true);
    }
    for (const name of UNTRUSTED_TOOLS) {
      expect(byName.get(name)?.annotations?.untrustedContentHint, name).toBe(true);
    }
    for (const tool of byName.values()) {
      if (tool.annotations?.readOnlyHint) {
        expect(tool.annotations.consequentialHint, tool.name).not.toBe(true);
      }
    }
  });

  it("hides flag-gated tools when their flags are off", async () => {
    const flags = {
      ...ALL_FLAGS,
      webMcpDemoLoginEnabled: false,
      financialCommoditiesTradingEnabled: false,
      staffFieldsExportEnabled: false,
    };

    const login = await startAndGet({ page: "login", authenticated: false, flags });
    const commodities = await startAndGet({ page: "financial-commodities", flags });
    const exportPage = await startAndGet({ page: "staff-fields-export", flags });

    expect(login.modelContext.tools.has("rolnopol.auth.loginAsDemo")).toBe(false);
    expect(commodities.modelContext.tools.has("rolnopol.commodities.getPrices")).toBe(true);
    expect(commodities.modelContext.tools.has("rolnopol.commodities.trade")).toBe(false);
    expect(exportPage.modelContext.tools.has("rolnopol.export.download")).toBe(false);
  });
});

describe("tool behaviour", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.staffFieldsMainPage;
    delete globalThis.sessionStorage;
  });

  const offer = { id: 4, sellerId: 2, itemType: "field", itemId: 14, price: 300, status: "active", details: { name: "Green Meadow", area: 120 } };

  function marketplaceRoutes(buy) {
    return {
      "GET marketplace/offers": envelope({ offers: [offer] }),
      "GET financial/account": envelope({ account: { balance: 1000, currency: "ROL" } }),
      "POST marketplace/buy": buy,
    };
  }

  it("does not buy an offer when the user cancels the confirmation", async () => {
    const buy = vi.fn(() => envelope({ ok: true }));
    const { service, modelContext } = await startAndGet({ page: "marketplace", routes: marketplaceRoutes(buy) });
    const confirm = vi.spyOn(service, "confirm").mockResolvedValue(false);

    const result = await run(modelContext, "rolnopol.marketplace.buyOffer", { offerId: 4 });

    expect(result).toEqual({ ok: false, error: "user_cancelled" });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Confirm purchase", details: expect.arrayContaining(["Price: 300 ROL"]) }));
    expect(buy).not.toHaveBeenCalled();
  });

  it("buys an offer after the user confirms and refreshes the page", async () => {
    const buy = vi.fn(() => envelope({ transactionId: 9 }));
    const marketplacePage = { _loadOffers: vi.fn(), _loadMyOffers: vi.fn(), _loadUserBalance: vi.fn(), _loadTransactions: vi.fn() };
    const { service, modelContext } = await startAndGet({
      page: "marketplace",
      routes: marketplaceRoutes(buy),
      modules: { marketplacePage },
    });
    vi.spyOn(service, "confirm").mockResolvedValue(true);

    const result = await run(modelContext, "rolnopol.marketplace.buyOffer", { offerId: 4 });

    expect(result).toEqual({ ok: true, purchase: { transactionId: 9 } });
    expect(buy).toHaveBeenCalledWith(expect.objectContaining({ body: { offerId: 4 } }));
    expect(marketplacePage._loadOffers).toHaveBeenCalled();
  });

  it("returns offer_not_found for an inactive offer without asking the user", async () => {
    const { service, modelContext } = await startAndGet({ page: "marketplace", routes: marketplaceRoutes(vi.fn()) });
    const confirm = vi.spyOn(service, "confirm");

    expect(await run(modelContext, "rolnopol.marketplace.buyOffer", { offerId: 99 })).toEqual({ ok: false, error: "offer_not_found" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not transfer money when the user cancels", async () => {
    const transfer = vi.fn();
    const { service, modelContext } = await startAndGet({ page: "financial", routes: { "POST financial/transfer": transfer } });
    vi.spyOn(service, "confirm").mockResolvedValue(false);

    const result = await run(modelContext, "rolnopol.finance.transfer", { toUserId: 2, amount: 10, description: "Seeds" });

    expect(result).toEqual({ ok: false, error: "user_cancelled" });
    expect(transfer).not.toHaveBeenCalled();
  });

  it("refuses to assign a staff member who already works on a field", async () => {
    const assign = vi.fn();
    const { modelContext } = await startAndGet({
      page: "staff-fields-assign",
      routes: {
        "GET fields": envelope([{ id: 1 }, { id: 2 }]),
        "GET staff": envelope([{ id: 7, name: "Long", surname: "Smith" }]),
        "GET animals": envelope([]),
        "GET fields/assign": envelope([{ id: 10, fieldId: 2, staffId: 7 }]),
        "POST fields/assign": assign,
      },
    });

    const result = await run(modelContext, "rolnopol.assignments.assign", { fieldId: 1, staffId: 7 });

    expect(result).toEqual({ ok: false, error: "staff_already_assigned", fieldId: 2, assignmentId: 10 });
    expect(assign).not.toHaveBeenCalled();
  });

  it("creates a field and refreshes the staff & fields page", async () => {
    const create = vi.fn(() => envelope({ id: 20, name: "North", area: 5 }));
    globalThis.staffFieldsMainPage = { _loadFields: vi.fn(), _renderStats: vi.fn() };
    const { modelContext } = await startAndGet({ page: "staff-fields-main", routes: { "POST fields": create } });

    const result = await run(modelContext, "rolnopol.fields.create", { name: " North ", area: 5 });

    expect(result).toEqual({ ok: true, field: { id: 20, name: "North", area: 5 } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: { name: "North", area: 5 } }));
    expect(globalThis.staffFieldsMainPage._loadFields).toHaveBeenCalledWith(true);
  });

  it("rejects an unknown animal type with the supported types", async () => {
    const { modelContext } = await startAndGet({
      page: "staff-fields-main",
      routes: { "GET animals/types": envelope({ cow: {}, pig: {} }) },
    });

    expect(await run(modelContext, "rolnopol.animals.add", { type: "dragon", amount: 1 })).toEqual({
      ok: false,
      error: "unknown_animal_type",
      availableTypes: ["cow", "pig"],
    });
  });

  it("summarises the farm for the overview tool", async () => {
    const { modelContext } = await startAndGet({
      routes: {
        "GET fields": envelope([
          { id: 1, name: "A", area: 10 },
          { id: 2, name: "B", area: 5 },
        ]),
        "GET staff": envelope([
          { id: 7, name: "Ann", surname: "Lee", age: 30 },
          { id: 8, name: "Bob", surname: "Ray", age: 40 },
        ]),
        "GET animals": envelope([
          { id: 3, type: "cow", amount: 4, fieldId: 1 },
          { id: 4, type: "cow", amount: 2 },
        ]),
        "GET fields/assign": envelope([{ id: 9, fieldId: 1, staffId: 7 }]),
        "GET financial/account": envelope({ account: { balance: 1360, currency: "ROL" } }),
      },
    });

    const result = await run(modelContext, "rolnopol.farm.getOverview", { includeItems: false });

    expect(result).toEqual({
      ok: true,
      fields: { count: 2, totalAreaHa: 15, withoutStaff: 1 },
      staff: { count: 2, unassigned: 1 },
      animals: { records: 2, totalAmount: 6, byType: { cow: 6 } },
      account: { balance: 1360, currency: "ROL" },
    });
  });

  it("lists alerts filtered by severity", async () => {
    const { modelContext } = await startAndGet({
      routes: {
        "GET alerts": envelope({
          today: {
            date: "2026-10-12",
            alerts: [
              { id: "a", severity: "high", title: "Frost" },
              { id: "b", severity: "low", title: "Wind" },
            ],
          },
          upcoming: { date: "2026-10-13", alerts: [{ id: "c", severity: "high", title: "Hail" }] },
          history: [],
        }),
      },
    });

    const result = await run(modelContext, "rolnopol.alerts.list", { severity: "high" });

    expect(result.today.map((alert) => alert.id)).toEqual(["a"]);
    expect(result.upcoming.alerts.map((alert) => alert.id)).toEqual(["c"]);
    expect(result.history).toBeUndefined();
  });

  it("returns the available regions for an unknown weather region", async () => {
    const { modelContext } = await startAndGet({
      routes: { "GET weather/regions": envelope({ regions: [{ code: "PL-14", name: "mazowieckie" }], defaultRegion: "PL-14" }) },
    });

    expect(await run(modelContext, "rolnopol.weather.getForecast", { region: "Atlantis" })).toEqual({
      ok: false,
      error: "unknown_region",
      availableRegions: [{ code: "PL-14", name: "mazowieckie" }],
    });
  });

  it("accepts only same-origin returnTo paths in auth.openLogin", async () => {
    const { modelContext } = await startAndGet({ authenticated: false });

    for (const returnTo of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"]) {
      const result = await run(modelContext, "rolnopol.auth.openLogin", { returnTo });
      expect(result.error, returnTo).toBe("invalid_input");
    }
  });

  it("stores the email and return path and opens the login page", async () => {
    vi.useFakeTimers();
    const store = {};
    globalThis.sessionStorage = { setItem: (key, value) => (store[key] = value) };
    globalThis.location = { assign: vi.fn() };
    const { modelContext } = await startAndGet({ authenticated: false });

    const result = await run(modelContext, "rolnopol.auth.openLogin", { email: "demo@example.com", returnTo: "/marketplace.html" });
    vi.runAllTimers();

    expect(result.ok).toBe(true);
    expect(store).toEqual({ "rolnopol.webmcp.loginEmail": "demo@example.com", "rolnopol.webmcp.returnTo": "/marketplace.html" });
    expect(globalThis.location.assign).toHaveBeenCalledWith("/login.html");
    delete globalThis.location;
  });

  it("does not log out when the user cancels", async () => {
    const { service, modelContext, modules } = await startAndGet();
    vi.spyOn(service, "confirm").mockResolvedValue(false);

    expect(await run(modelContext, "rolnopol.auth.logout", {})).toEqual({ ok: false, error: "user_cancelled" });
    expect(modules.authService.logout).not.toHaveBeenCalled();
  });

  it("reports password rules from the registration flag", async () => {
    const { modelContext } = await startAndGet({
      page: "register",
      authenticated: false,
      flags: { ...ALL_FLAGS, registrationStrongPasswordEnabled: true },
    });

    const result = await run(modelContext, "rolnopol.auth.getPasswordRules", {});

    expect(result).toMatchObject({ ok: true, strongPasswordEnabled: true, minLength: 8, requiresSpecialCharacter: true });
  });
});
