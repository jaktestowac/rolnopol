// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// load the component -- contains helpers and will attach to window in browser
const { hasConsentCookie, hideBanner, createBanner, initCookieConsent } = require("../../public/js/components/cookie-consent.js");

// helpers to reset DOM state between tests
function clearBanner() {
  const existing = document.getElementById("cookie-consent-banner");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

function makeFakeApp(featureFlagsService, bus) {
  window.App = {
    getModule: () => featureFlagsService,
    getEventBus: () => bus,
  };
}

describe("cookie-consent component", () => {
  beforeEach(() => {
    // ensure a clean document body
    document.body.innerHTML = "";
    delete window.App;
    vi.useRealTimers();
  });

  afterEach(() => {
    clearBanner();
    delete window.App;
  });

  it("detects existing consent cookie correctly", () => {
    document.cookie = "rolnopolCookieConsent=accepted";
    expect(hasConsentCookie()).toBe(true);
    document.cookie = "rolnopolCookieConsent=denied";
    expect(hasConsentCookie()).toBe(false);
  });

  it("createBanner and hideBanner manipulate DOM as expected", () => {
    createBanner();
    const el = document.getElementById("cookie-consent-banner");
    expect(el).not.toBeNull();
    expect(el.style.display).not.toBe("none");

    hideBanner();
    expect(el.style.display).toBe("none");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not render banner when feature flag is disabled", async () => {
    const service = { isEnabled: vi.fn().mockResolvedValue(false) };
    const bus = new EventEmitter();
    makeFakeApp(service, bus);

    await initCookieConsent();
    expect(document.getElementById("cookie-consent-banner")).toBeNull();
  });

  it("renders banner when flag enabled and hides when flag turned off later", async () => {
    const service = { isEnabled: vi.fn().mockResolvedValue(true) };
    const bus = new EventEmitter();
    makeFakeApp(service, bus);

    // initial call should create the banner
    await initCookieConsent();
    let el = document.getElementById("cookie-consent-banner");
    expect(el).not.toBeNull();

    // simulate toggling feature off
    service.isEnabled.mockResolvedValue(false);
    bus.emit("feature-flags:changed");
    // give async listener a chance to run
    await new Promise((r) => setTimeout(r, 0));

    el = document.getElementById("cookie-consent-banner");
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("adds banner when flag is off initially then toggled on", async () => {
    const service = { isEnabled: vi.fn().mockResolvedValue(false) };
    const bus = new EventEmitter();
    makeFakeApp(service, bus);

    await initCookieConsent();
    expect(document.getElementById("cookie-consent-banner")).toBeNull();

    // toggle on
    service.isEnabled.mockResolvedValue(true);
    bus.emit("feature-flags:changed");
    await new Promise((r) => setTimeout(r, 0));

    const el = document.getElementById("cookie-consent-banner");
    expect(el).not.toBeNull();
  });
});
