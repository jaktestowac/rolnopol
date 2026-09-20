import { describe, it, expect, beforeEach, vi } from "vitest";

// The flags page must never offer a toggle that cannot take effect: flags pinned
// by feature-flags.ini render locked, the banner says so, and bulk actions skip
// them instead of failing wholesale.
global.window = global.window || {};
require("../../public/js/pages/feature-flags.js");

function stubElement() {
  const classes = new Set();
  return {
    innerHTML: "",
    textContent: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
    },
  };
}

function makePage() {
  const page = new window.FeatureFlagsPage();
  page.overrideBannerEl = stubElement();
  page.pinnedMetaEl = stubElement();
  page.pinnedFlagsCountEl = stubElement();
  return page;
}

const PAYLOAD = {
  flags: {
    crewOfficeEnabled: { value: true, description: "Crew Office", storedValue: false, overriddenBy: "feature-flags.ini" },
    messengerEnabled: { value: false, description: "Messenger" },
  },
  groups: { crewOffice: ["crewOfficeEnabled"], communication: ["messengerEnabled"] },
  experimentalFlags: ["crewOfficeEnabled"],
  overrides: { source: "feature-flags.ini", active: true, enforcing: true, mode: "enforce", count: 1, keys: ["crewOfficeEnabled"] },
};

let page;

beforeEach(() => {
  page = makePage();
});

describe("_readOverrides", () => {
  it("pins the flags an enforcing file lists", () => {
    page._readOverrides(PAYLOAD);

    expect([...page.pinnedFlags]).toEqual(["crewOfficeEnabled"]);
    expect(page._isPinned("crewOfficeEnabled")).toBe(true);
    expect(page._isPinned("messengerEnabled")).toBe(false);
  });

  it("pins nothing when the override layer is inactive", () => {
    page._readOverrides({ overrides: { source: "feature-flags.ini", active: false, enforcing: false, keys: [] } });

    expect(page.pinnedFlags.size).toBe(0);
  });

  it("pins nothing in seed mode, where the app still owns the value", () => {
    page._readOverrides({ overrides: { active: true, enforcing: false, mode: "seed", keys: ["crewOfficeEnabled"] } });

    expect(page.pinnedFlags.size).toBe(0);
  });

  it("survives a payload from a server that does not report overrides", () => {
    page._readOverrides({ flags: {} });

    expect(page.overrides).toBeNull();
    expect(page.pinnedFlags.size).toBe(0);
  });

  it("ignores non-string keys", () => {
    page._readOverrides({ overrides: { active: true, enforcing: true, keys: ["ok", 42, null, { a: 1 }] } });

    expect([...page.pinnedFlags]).toEqual(["ok"]);
  });
});

describe("_renderOverrideBanner", () => {
  it("shows the file name, the count and the pinned keys", () => {
    page._readOverrides(PAYLOAD);
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.classList.contains("is-hidden")).toBe(false);
    expect(page.overrideBannerEl.innerHTML).toContain("feature-flags.ini");
    expect(page.overrideBannerEl.innerHTML).toContain("1 flag");
    expect(page.overrideBannerEl.innerHTML).toContain("crewOfficeEnabled");
    expect(page.pinnedFlagsCountEl.textContent).toBe("1");
    expect(page.pinnedMetaEl.classList.contains("is-hidden")).toBe(false);
  });

  it("pluralises the count", () => {
    page._readOverrides({ overrides: { active: true, enforcing: true, keys: ["a", "b"], source: "feature-flags.ini" } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).toContain("2 flags");
  });

  it("stays hidden and empty when nothing is pinned", () => {
    page._readOverrides({ overrides: { active: false, keys: [] } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.classList.contains("is-hidden")).toBe(true);
    expect(page.overrideBannerEl.innerHTML).toBe("");
    expect(page.pinnedMetaEl.classList.contains("is-hidden")).toBe(true);
  });

  it("escapes a hostile source name instead of injecting markup", () => {
    page._readOverrides({
      overrides: { active: true, enforcing: true, keys: ["<img src=x onerror=alert(1)>"], source: "<script>bad()</script>" },
    });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).not.toContain("<script>");
    expect(page.overrideBannerEl.innerHTML).not.toContain("<img");
    expect(page.overrideBannerEl.innerHTML).toContain("&lt;script&gt;");
  });
});

describe("_renderOverrideBanner: problems in an invalid file", () => {
  const PROBLEMS = [
    { kind: "syntax", line: 4, message: "Line 4: Malformed line, expected `key = value`" },
    { kind: "invalid-value", key: "messengerEnabled", message: 'Ignored "messengerEnabled = perhaps": Not a boolean' },
  ];

  it("warns even when nothing ended up pinned", () => {
    page._readOverrides({ overrides: { source: "feature-flags.ini", active: false, keys: [], problems: PROBLEMS } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.classList.contains("is-hidden")).toBe(false);
    expect(page.overrideBannerEl.classList.contains("flags-override-banner--problems")).toBe(true);
    expect(page.overrideBannerEl.innerHTML).toContain("2 problems");
    expect(page.overrideBannerEl.innerHTML).toContain("Line 4");
    expect(page.overrideBannerEl.innerHTML).toContain("messengerEnabled = perhaps");
  });

  it("says the app started normally so the warning is not read as a failure", () => {
    page._readOverrides({ overrides: { active: false, keys: [], problems: PROBLEMS } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).toContain("The app started normally");
  });

  it("shows the pinned summary and the problems together", () => {
    page._readOverrides({
      overrides: { source: "feature-flags.ini", active: true, enforcing: true, keys: ["crewOfficeEnabled"], problems: PROBLEMS },
    });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).toContain("1 flag overridden");
    expect(page.overrideBannerEl.innerHTML).toContain("2 problems");
    // Pinned flags exist, so the banner keeps its normal (non-error) styling.
    expect(page.overrideBannerEl.classList.contains("flags-override-banner--problems")).toBe(false);
  });

  it("uses the singular form for a single problem", () => {
    page._readOverrides({ overrides: { active: false, keys: [], problems: [PROBLEMS[0]] } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).toContain("1 problem in");
  });

  it("escapes problem text", () => {
    page._readOverrides({ overrides: { active: false, keys: [], problems: [{ kind: "syntax", message: "<img src=x onerror=1>" }] } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.innerHTML).not.toContain("<img");
    expect(page.overrideBannerEl.innerHTML).toContain("&lt;img");
  });

  it("ignores malformed problem entries from the server", () => {
    page._readOverrides({ overrides: { active: false, keys: [], problems: [null, 42, {}, { message: "real problem" }] } });
    page._renderOverrideBanner();

    expect(page.overrideProblems).toHaveLength(1);
    expect(page.overrideBannerEl.innerHTML).toContain("1 problem in");
  });

  it("stays hidden for a clean file with nothing pinned", () => {
    page._readOverrides({ overrides: { active: false, keys: [], problems: [] } });
    page._renderOverrideBanner();

    expect(page.overrideBannerEl.classList.contains("is-hidden")).toBe(true);
    expect(page.overrideBannerEl.innerHTML).toBe("");
  });
});

describe("_renderFlagCard", () => {
  beforeEach(() => {
    page._readOverrides(PAYLOAD);
    page.flags = { ...PAYLOAD.flags };
    page.experimentalFlags = new Set(PAYLOAD.experimentalFlags);
  });

  it("disables the toggle of a pinned flag and badges it", () => {
    const html = page._renderFlagCard("crewOfficeEnabled");

    expect(html).toContain("flags-card--pinned");
    expect(html).toContain("flags-badge--pinned");
    expect(html).toContain("disabled");
    expect(html).toContain('data-flag="crewOfficeEnabled"');
  });

  it("mentions the stored value in the badge tooltip when it differs", () => {
    const html = page._renderFlagCard("crewOfficeEnabled");

    expect(html).toContain("stored value: Off");
  });

  it("leaves an unpinned flag fully editable", () => {
    const html = page._renderFlagCard("messengerEnabled");

    expect(html).not.toContain("flags-card--pinned");
    expect(html).not.toContain("flags-badge--pinned");
    expect(html).not.toContain("disabled");
  });

  it("returns nothing for a flag that is not in the current view", () => {
    expect(page._renderFlagCard("notLoadedEnabled")).toBe("");
  });

  it("keeps the experimental badge alongside the pinned badge", () => {
    const html = page._renderFlagCard("crewOfficeEnabled");

    expect(html).toContain("flags-badge--experimental");
  });
});

describe("bulk actions and toggles", () => {
  beforeEach(() => {
    page._readOverrides(PAYLOAD);
    page.allFlags = { ...PAYLOAD.flags };
    page.flags = { ...PAYLOAD.flags };
    page._loadFlags = vi.fn().mockResolvedValue(undefined);
    page._setStatus = vi.fn();
    page.featureFlagsService = {
      updateFlags: vi.fn().mockResolvedValue({ success: true, data: { data: { flags: {} } } }),
    };
  });

  it("leaves pinned flags out of a bulk enable and says how many were skipped", async () => {
    await page._setAllFlags(true);

    expect(page.featureFlagsService.updateFlags).toHaveBeenCalledWith({ messengerEnabled: true });
    expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("All flags enabled."));
  });

  it("reports the pinned flag it cannot disable even when there is nothing else to do", async () => {
    // messengerEnabled is already off; crewOfficeEnabled is pinned to on.
    await page._setAllFlags(false);

    expect(page.featureFlagsService.updateFlags).not.toHaveBeenCalled();
    expect(page._setStatus.mock.calls[0][0]).toContain("All flags are already disabled.");
    expect(page._setStatus.mock.calls[0][0]).toContain("1 pinned flag left unchanged");
  });

  it("sends the unpinned change and reports the pinned one when both are pending", async () => {
    page.allFlags = {
      crewOfficeEnabled: PAYLOAD.flags.crewOfficeEnabled,
      messengerEnabled: { value: true, description: "Messenger" },
    };

    await page._setAllFlags(false);

    expect(page.featureFlagsService.updateFlags).toHaveBeenCalledWith({ messengerEnabled: false });
    expect(page._setStatus.mock.calls[0][0]).toContain("1 pinned flag left unchanged");
  });

  it("does not send a request when only pinned flags would change", async () => {
    page.allFlags = { crewOfficeEnabled: PAYLOAD.flags.crewOfficeEnabled };

    await page._setAllFlags(false);

    expect(page.featureFlagsService.updateFlags).not.toHaveBeenCalled();
    expect(page._setStatus.mock.calls[0][0]).toContain("1 pinned flag left unchanged");
  });

  it("refuses to send a toggle for a pinned flag and re-syncs from the server", async () => {
    await page._toggleFlag("crewOfficeEnabled", false);

    expect(page.featureFlagsService.updateFlags).not.toHaveBeenCalled();
    expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("pinned by feature-flags.ini"), true);
    expect(page._loadFlags).toHaveBeenCalled();
  });

  it("still sends a toggle for an unpinned flag", async () => {
    await page._toggleFlag("messengerEnabled", true);

    expect(page.featureFlagsService.updateFlags).toHaveBeenCalledWith({ messengerEnabled: true });
  });
});
