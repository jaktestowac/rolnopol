import { describe, it, expect, beforeEach } from "vitest";

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
