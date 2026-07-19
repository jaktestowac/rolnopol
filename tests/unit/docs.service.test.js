import { describe, expect, it } from "vitest";

const docsService = require("../../services/docs.service");
const baseDocs = require("../../data/docs.json");

describe("docs service search", () => {
  it("matches natural-language questions for demo accounts", async () => {
    const result = await docsService.search("what are demo accounts?");

    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches[0].title).toBe("Demo Accounts");
    expect(result.answer).toContain('Documentation search results for "what are demo accounts?"');
  });

  it("still supports direct section queries", async () => {
    const result = await docsService.search("user roles");

    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches.some((item) => item.title === "User Types & Permissions")).toBe(true);
  });
});

describe("docs service feature-flagged sections", () => {
  it("adds a section for an enabled feature flag", async () => {
    const docs = await docsService.getAll({ twoFactorAuthEnabled: true });

    const twoFactor = docs.find((section) => section.section === "two-factor-auth");
    expect(twoFactor).toBeDefined();
    expect(twoFactor.isFeatureFlagged).toBe(true);
    expect(twoFactor.featureFlags).toContain("twoFactorAuthEnabled");
  });

  it("omits a section when its feature flag is disabled", async () => {
    const docs = await docsService.getAll({ twoFactorAuthEnabled: false });

    expect(docs.some((section) => section.section === "two-factor-auth")).toBe(false);
  });

  it("documents the commodities trading flag whenever it is enabled", async () => {
    const off = await docsService.getAll({ financialCommoditiesTradingEnabled: false });
    expect(off.some((section) => section.section === "financial-commodities-trading")).toBe(false);

    // Shown on its own flag, even without the parent commodities flag, so the
    // flag is always documented when enabled.
    const on = await docsService.getAll({ financialCommoditiesTradingEnabled: true });
    expect(on.some((section) => section.section === "financial-commodities-trading")).toBe(true);
  });

  it("always includes the base docs regardless of flags", async () => {
    const docs = await docsService.getAll({});

    expect(docs.some((section) => section.section === "overview")).toBe(true);
    expect(docs.some((section) => section.section === "demo-accounts")).toBe(true);
  });

  it("returns the base docs unchanged when no flags are enabled (backward compatible)", async () => {
    const docs = await docsService.getAll({});

    // Same count, order, and content as data/docs.json — no feature sections,
    // no added fields. This is the pre-existing docs API contract.
    expect(docs).toEqual(baseDocs);
    expect(docs.some((section) => section.isFeatureFlagged)).toBe(false);
  });

  it("keeps base sections intact and appends feature sections after them", async () => {
    const docs = await docsService.getAll({ twoFactorAuthEnabled: true });

    // Base docs are still the first N sections, byte-for-byte.
    expect(docs.slice(0, baseDocs.length)).toEqual(baseDocs);
    // Feature sections only ever appear after the base docs.
    expect(docs.length).toBeGreaterThan(baseDocs.length);
    docs.slice(baseDocs.length).forEach((section) => {
      expect(section.isFeatureFlagged).toBe(true);
    });
  });

  it("surfaces enabled feature docs in search", async () => {
    const result = await docsService.search("two-factor authentication", 3, { twoFactorAuthEnabled: true });

    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches.some((item) => item.section === "two-factor-auth")).toBe(true);
  });

  it("includes an any-of section when at least one flag is enabled", async () => {
    const docs = await docsService.getAll({ homeStatsSectionEnabled: true });

    const homepage = docs.find((section) => section.section === "homepage-features");
    expect(homepage).toBeDefined();
    // Only the enabled flag(s) are reported on the badge, not the whole group.
    expect(homepage.featureFlags).toEqual(["homeStatsSectionEnabled"]);
  });

  it("omits an any-of section when none of its flags are enabled", async () => {
    const docs = await docsService.getAll({
      homeWelcomeVideoEnabled: false,
      homeStatsSectionEnabled: false,
      homeModernRestyleEnabled: false,
    });

    expect(docs.some((section) => section.section === "homepage-features")).toBe(false);
  });

  it("shows at least one section for every feature flag when enabled alone", async () => {
    const featureFlagsService = require("../../services/feature-flags.service");
    const { flags } = await featureFlagsService.getFeatureFlags();
    const flagKeys = Object.keys(flags);

    const baseCount = (await docsService.getAll({})).filter((s) => s.isFeatureFlagged).length;

    const missing = [];
    for (const key of flagKeys) {
      const docs = await docsService.getAll({ [key]: true });
      const flaggedCount = docs.filter((s) => s.isFeatureFlagged).length;
      if (flaggedCount <= baseCount) {
        missing.push(key);
      }
    }

    expect(missing).toEqual([]);
  });
});
