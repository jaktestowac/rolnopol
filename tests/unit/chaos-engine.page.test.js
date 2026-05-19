import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

// tests reference the global `window` object, so make sure it exists *before* loading
// the page script. set a simple window object and import the script once at top level.

// create a fake window before any module executes
global.window = global.window || {};
require("../../public/js/pages/chaos-engine.js");

describe("ChaosEnginePage form helpers", () => {
  beforeEach(() => {
    // reset the stub window between tests just in case
    global.window = global.window || {};
  });
  it("_buildCustomConfigFromForm includes new options", () => {
    const page = new window.ChaosEnginePage();

    // stub DOM elements with simple objects
    page.latencyEnabledEl = { checked: true, value: "" };
    page.latencyProbabilityEl = { value: "0.25" };
    page.latencyMinMsEl = { value: "10" };
    page.latencyMaxMsEl = { value: "50" };

    page.lossEnabledEl = { checked: false, value: "" };
    page.lossProbabilityEl = { value: "0" };
    page.lossModeEl = { value: "timeout" };
    page.lossTimeoutMsEl = { value: "1000" };

    page.errorEnabledEl = { checked: true };
    page.errorRandomStatusEl = { checked: true };
    page.errorProbabilityEl = { value: "0.5" };
    page.errorStatusCodesEl = { value: "400,402" };
    page.errorMessageEl = { value: "bad" };

    page.statefulEnabledEl = { checked: true };
    page.statefulRequestCountEl = { value: "3" };

    page.mirroringEnabledEl = { checked: true };
    page.mirroringProbabilityEl = { value: "0.2" };
    page.mirroringTargetUrlEl = { value: "http://foo" };

    page.scopeMethodsEl = { value: "GET,POST" };
    page.scopeExcludePathsEl = { value: "/a\n/b" };
    page.scopePercentOfTrafficEl = { value: "42" };
    // new fields
    page.scopeIncludePathsEl = { value: "/a" };
    page.scopeQueryParamsEl = { value: "foo=bar" };
    page.scopeHeadersEl = { value: "x-test:foo" };
    page.scopeHostnamesEl = { value: "example.com" };
    page.scopeRolesEl = { value: "admin" };
    page.scopeIpRangesEl = { value: "1.2.3.4" };
    page.scopeGeolocationEl = { value: "us" };

    const cfg = page._buildCustomConfigFromForm();
    expect(cfg).toEqual({
      enabled: true,
      latency: { enabled: true, probability: 0.25, minMs: 10, maxMs: 50 },
      responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
      errorInjection: {
        enabled: true,
        probability: 0.5,
        statusCodes: [400, 402],
        randomStatus: true,
        message: "bad",
      },
      stateful: { enabled: true, requestCount: 3 },
      mirroring: { enabled: true, probability: 0.2, targetUrl: "http://foo" },
      scope: {
        methods: ["GET", "POST"],
        excludePaths: ["/a", "/b"],
        includePaths: ["/a"],
        queryParams: { foo: "bar" },
        headers: { "x-test": "foo" },
        hostnames: ["example.com"],
        roles: ["admin"],
        ipRanges: ["1.2.3.4"],
        geolocation: ["us"],
        percentOfTraffic: 42,
      },
    });
  });

  it("_renderCustomConfig populates form fields including new options", () => {
    const page = new window.ChaosEnginePage();

    // set up stubs with defaults that can be mutated by render
    const makeElement = (initial = "") => ({ checked: false, value: initial });
    page.latencyEnabledEl = makeElement();
    page.latencyProbabilityEl = makeElement();
    page.latencyMinMsEl = makeElement();
    page.latencyMaxMsEl = makeElement();
    page.lossEnabledEl = makeElement();
    page.lossProbabilityEl = makeElement();
    page.lossModeEl = makeElement();
    page.lossTimeoutMsEl = makeElement();
    page.errorEnabledEl = makeElement();
    page.errorRandomStatusEl = makeElement();
    page.errorProbabilityEl = makeElement();
    page.errorStatusCodesEl = makeElement();
    page.errorMessageEl = makeElement();
    page.statefulEnabledEl = makeElement();
    page.statefulRequestCountEl = makeElement();
    page.mirroringEnabledEl = makeElement();
    page.mirroringProbabilityEl = makeElement();
    page.mirroringTargetUrlEl = makeElement();
    page.scopeMethodsEl = makeElement();
    page.scopeExcludePathsEl = makeElement();
    page.scopePercentOfTrafficEl = makeElement();
    page.scopeIncludePathsEl = makeElement();
    page.scopeQueryParamsEl = makeElement();
    page.scopeHeadersEl = makeElement();
    page.scopeHostnamesEl = makeElement();
    page.scopeRolesEl = makeElement();
    page.scopeIpRangesEl = makeElement();
    page.scopeGeolocationEl = makeElement();

    const payload = {
      customConfig: {
        latency: { enabled: false, probability: 0.9, minMs: 1, maxMs: 2 },
        responseLoss: { enabled: true, probability: 0.1, mode: "drop", timeoutMs: 500 },
        errorInjection: { enabled: false, probability: 0, statusCodes: [501], message: "x", randomStatus: false },
        stateful: { enabled: true, requestCount: 7 },
        mirroring: { enabled: false, probability: 0, targetUrl: "" },
        scope: { methods: ["PUT"], excludePaths: ["/x"], includePaths: ["/x"], percentOfTraffic: 77 },
      },
    };

    page._renderCustomConfig(payload);

    expect(page.latencyEnabledEl.checked).toBe(false);
    expect(page.latencyProbabilityEl.value).toBe(0.9);
    expect(page.lossModeEl.value).toBe("drop");
    expect(page.errorRandomStatusEl.checked).toBe(false);
    expect(page.statefulEnabledEl.checked).toBe(true);
    expect(page.statefulRequestCountEl.value).toBe(7);
    expect(page.scopePercentOfTrafficEl.value).toBe(77);
    expect(page.scopeIncludePathsEl.value).toBe("/x");
    // other new fields should populate but not strictly verified here
  });
});

describe("ChaosEnginePage load behavior when the engine is off", () => {
  let previousDocument;

  function createElement(initialValue = "") {
    return {
      checked: false,
      value: initialValue,
      textContent: "",
      innerHTML: "",
      hidden: false,
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    previousDocument = global.document;

    const elementMap = new Map([
      ["chaosMode", createElement()],
      ["chaosModePanel", createElement()],
      ["chaosModeDescription", createElement()],
      ["chaosUpdatedAt", createElement()],
      ["chaosPreviewSummary", createElement()],
      ["chaosPreviewHighlights", createElement()],
      ["chaosPreviewConfigDisplay", createElement()],
      ["chaosPreviewBadge", createElement()],
      ["chaosSummary", createElement()],
      ["chaosConfigDisplay", createElement()],
      ["reloadChaosBtn", createElement()],
      ["resetChaosBtn", createElement()],
      ["applyModeBtn", createElement()],
      ["saveCustomBtn", createElement()],
      ["latencyEnabled", createElement()],
      ["latencyProbability", createElement()],
      ["latencyMinMs", createElement()],
      ["latencyMaxMs", createElement()],
      ["lossEnabled", createElement()],
      ["lossProbability", createElement()],
      ["lossMode", createElement("timeout")],
      ["lossTimeoutMs", createElement()],
      ["errorEnabled", createElement()],
      ["errorProbability", createElement()],
      ["errorStatusCodes", createElement()],
      ["errorMessage", createElement()],
      ["errorRandomStatus", createElement()],
      ["statefulEnabled", createElement()],
      ["statefulRequestCount", createElement()],
      ["mirroringEnabled", createElement()],
      ["mirroringProbability", createElement()],
      ["mirroringTargetUrl", createElement()],
      ["scopeMethods", createElement()],
      ["scopeExcludePaths", createElement()],
      ["scopePercentOfTraffic", createElement()],
      ["scopeIncludePaths", createElement()],
      ["scopeQueryParams", createElement()],
      ["scopeHeaders", createElement()],
      ["scopeHostnames", createElement()],
      ["scopeRoles", createElement()],
      ["scopeIpRanges", createElement()],
      ["scopeGeolocation", createElement()],
      ["chaosGroupLatency", createElement()],
      ["chaosGroupResponseLoss", createElement()],
      ["chaosGroupErrorInjection", createElement()],
      ["chaosGroupScope", createElement()],
      ["chaosGroupStateful", createElement()],
      ["chaosGroupMirroring", createElement()],
    ]);

    global.document = {
      getElementById: vi.fn((id) => elementMap.get(id) || null),
    };

    global.__chaosEngineTestElements = elementMap;
  });

  afterEach(() => {
    global.document = previousDocument;
    delete global.__chaosEngineTestElements;
  });

  it("resets the form from the resolved off config instead of stale custom values", async () => {
    const page = new window.ChaosEnginePage();
    page.apiService = {
      get: vi.fn(async () => ({
        success: true,
        data: {
          data: {
            mode: "off",
            config: {
              enabled: false,
              latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
              responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
              errorInjection: {
                enabled: false,
                probability: 0,
                statusCodes: [500],
                randomStatus: false,
                message: "Synthetic chaos error",
              },
              stateful: { enabled: false, requestCount: 0 },
              mirroring: { enabled: false, probability: 0, targetUrl: "" },
              scope: {
                methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
                excludePaths: ["/v1/chaos-engine*"],
                includePaths: [],
                queryParams: {},
                headers: {},
                hostnames: [],
                roles: [],
                ipRanges: [],
                geolocation: [],
                percentOfTraffic: 100,
              },
            },
            customConfig: {
              enabled: true,
              latency: { enabled: true, probability: 1, minMs: 999, maxMs: 1000 },
              responseLoss: { enabled: true, probability: 1, mode: "drop", timeoutMs: 9999 },
              errorInjection: {
                enabled: true,
                probability: 1,
                statusCodes: [599],
                randomStatus: true,
                message: "stale custom values",
              },
              stateful: { enabled: true, requestCount: 42 },
              mirroring: { enabled: true, probability: 1, targetUrl: "http://mirror" },
              scope: {
                methods: ["DELETE"],
                excludePaths: ["/stale"],
                percentOfTraffic: 5,
              },
            },
            presets: {
              off: { label: "Off", description: "No perturbation." },
            },
            previewConfigs: {
              off: {
                enabled: false,
                latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
                responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
                errorInjection: {
                  enabled: false,
                  probability: 0,
                  statusCodes: [500],
                  randomStatus: false,
                  message: "Synthetic chaos error",
                },
                stateful: { enabled: false, requestCount: 0 },
                mirroring: { enabled: false, probability: 0, targetUrl: "" },
                scope: {
                  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
                  excludePaths: ["/v1/chaos-engine*"],
                  includePaths: [],
                  queryParams: {},
                  headers: {},
                  hostnames: [],
                  roles: [],
                  ipRanges: [],
                  geolocation: [],
                  percentOfTraffic: 100,
                },
              },
            },
            updatedAt: "2026-05-19T12:00:00.000Z",
          },
        },
      })),
    };

    page._cacheDom();

    await page._load();

    expect(page.modeEl.value).toBe("off");
    expect(page.latencyEnabledEl.checked).toBe(false);
    expect(page.lossEnabledEl.checked).toBe(false);
    expect(page.errorEnabledEl.checked).toBe(false);
    expect(page.statefulEnabledEl.checked).toBe(false);
    expect(page.mirroringEnabledEl.checked).toBe(false);
    expect(page.errorStatusCodesEl.value).toBe("500");
    expect(page.scopeMethodsEl.value).toBe("GET,POST,PUT,PATCH,DELETE");
    expect(page.scopePercentOfTrafficEl.value).toBe(100);
    expect(page.scopeExcludePathsEl.value).toContain("/v1/chaos-engine*");
    expect(page.previewSummaryEl.textContent).toContain("Preview matches the applied");
    expect(page.previewConfigDisplayEl.textContent).toContain('"enabled": false');
  });

  it("hydrates the form from preview configs when selecting a preset before apply", () => {
    const page = new window.ChaosEnginePage();
    page._cacheDom();
    page.currentPayload = {
      mode: "off",
      config: {
        enabled: false,
        latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
        responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
        errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "Synthetic chaos error" },
        stateful: { enabled: false, requestCount: 0 },
        mirroring: { enabled: false, probability: 0, targetUrl: "" },
        scope: {
          methods: ["GET"],
          excludePaths: [],
          includePaths: [],
          queryParams: {},
          headers: {},
          hostnames: [],
          roles: [],
          ipRanges: [],
          geolocation: [],
          percentOfTraffic: 100,
        },
      },
      customConfig: {
        enabled: true,
        latency: { enabled: true, probability: 0.15, minMs: 10, maxMs: 30 },
        responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
        errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "draft" },
        stateful: { enabled: false, requestCount: 0 },
        mirroring: { enabled: false, probability: 0, targetUrl: "" },
        scope: {
          methods: ["GET"],
          excludePaths: [],
          includePaths: [],
          queryParams: {},
          headers: {},
          hostnames: [],
          roles: [],
          ipRanges: [],
          geolocation: [],
          percentOfTraffic: 100,
        },
      },
      presets: {
        off: { label: "Off", description: "No perturbation." },
        custom: { label: "Custom", description: "User-defined chaos parameters." },
        level3: { label: "Level 3 - Turbulent", description: "Frequent latency spikes and random faults." },
      },
      previewConfigs: {
        off: {
          enabled: false,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "Synthetic chaos error" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: {
            methods: ["GET"],
            excludePaths: [],
            includePaths: [],
            queryParams: {},
            headers: {},
            hostnames: [],
            roles: [],
            ipRanges: [],
            geolocation: [],
            percentOfTraffic: 100,
          },
        },
        custom: {
          enabled: true,
          latency: { enabled: true, probability: 0.15, minMs: 10, maxMs: 30 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "draft" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: {
            methods: ["GET"],
            excludePaths: [],
            includePaths: [],
            queryParams: {},
            headers: {},
            hostnames: [],
            roles: [],
            ipRanges: [],
            geolocation: [],
            percentOfTraffic: 100,
          },
        },
        level3: {
          enabled: true,
          latency: { enabled: true, probability: 0.5, minMs: 150, maxMs: 650 },
          responseLoss: { enabled: true, probability: 0.02, mode: "timeout", timeoutMs: 1800 },
          errorInjection: { enabled: true, probability: 0.07, statusCodes: [500, 502, 503], randomStatus: false, message: "Chaos L3" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: {
            methods: ["GET"],
            excludePaths: [],
            includePaths: [],
            queryParams: {},
            headers: {},
            hostnames: [],
            roles: [],
            ipRanges: [],
            geolocation: [],
            percentOfTraffic: 100,
          },
        },
      },
    };

    page.customDraftConfig = page._cloneConfig(page.currentPayload.customConfig);
    page.modeEl.value = "level3";

    page._handleModeSelectionChange();

    expect(page.latencyEnabledEl.checked).toBe(true);
    expect(page.latencyProbabilityEl.value).toBe(0.5);
    expect(page.lossEnabledEl.checked).toBe(true);
    expect(page.lossTimeoutMsEl.value).toBe(1800);
    expect(page.previewSummaryEl.textContent).toContain("Previewing Level 3 - Turbulent");
    expect(page.previewHighlightsEl.innerHTML).toContain("Latency");
    expect(page.previewHighlightsEl.innerHTML).toContain("Applied: Off");
  });
});
