import { describe, it, expect } from "vitest";
const path = require("path");

// Pure branding validation/normalisation — single source of truth shared by the
// authoring service and the console picker. Never exercised by a direct unit test.
const presets = require(
  path.join(__dirname, "..", "..", "external-services", "agri-academy", "authoring-service", "unit-presets.js"),
);

describe("agri-academy unit-presets — constants", () => {
  it("exposes the predefined icon set, palette and defaults", () => {
    expect(Array.isArray(presets.ICON_KEYS)).toBe(true);
    expect(presets.ICON_KEYS).toContain("tractor");
    expect(presets.ICON_KEYS).toContain(presets.DEFAULT_ICON);
    expect(presets.PALETTE).toContain(presets.DEFAULT_COLOR);
    expect(presets.DEFAULT_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("agri-academy unit-presets — sanitizeBranding (tags)", () => {
  it("returns an empty value object when no branding fields are present", () => {
    expect(presets.sanitizeBranding({})).toEqual({ value: {} });
    expect(presets.sanitizeBranding(undefined)).toEqual({ value: {} });
  });

  it("errors when tags is not an array", () => {
    expect(presets.sanitizeBranding({ tags: "corn" })).toEqual({ error: "tags must be an array of strings" });
  });

  it("trims, drops empties and dedupes tags case-insensitively (keeping first casing)", () => {
    const result = presets.sanitizeBranding({ tags: ["  Corn  ", "corn", "WHEAT", "  ", ""] });
    expect(result).toEqual({ value: { tags: ["Corn", "WHEAT"] } });
  });

  it("caps tags at 8 entries", () => {
    const many = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    const result = presets.sanitizeBranding({ tags: many });
    expect(result.value.tags).toHaveLength(8);
  });

  it("truncates an over-long tag to 24 characters", () => {
    const result = presets.sanitizeBranding({ tags: ["x".repeat(40)] });
    expect(result.value.tags[0]).toHaveLength(24);
  });
});

describe("agri-academy unit-presets — sanitizeBranding (color)", () => {
  it("accepts and lower-cases a 6-digit hex color", () => {
    expect(presets.sanitizeBranding({ color: "#3FAE6B" })).toEqual({ value: { color: "#3fae6b" } });
  });

  it("rejects a non-hex color", () => {
    expect(presets.sanitizeBranding({ color: "red" })).toEqual({ error: "color must be a hex value like #3fae6b" });
    expect(presets.sanitizeBranding({ color: "#abc" })).toEqual({ error: "color must be a hex value like #3fae6b" });
  });
});

describe("agri-academy unit-presets — sanitizeBranding (icon)", () => {
  it("accepts a bare predefined icon key", () => {
    expect(presets.sanitizeBranding({ icon: "tractor" })).toEqual({ value: { icon: "tractor" } });
  });

  it("strips Font Awesome prefixes before matching", () => {
    expect(presets.sanitizeBranding({ icon: "fa-solid fa-tractor" })).toEqual({ value: { icon: "tractor" } });
    expect(presets.sanitizeBranding({ icon: "fa-cow" })).toEqual({ value: { icon: "cow" } });
  });

  it("rejects an icon outside the predefined list", () => {
    expect(presets.sanitizeBranding({ icon: "rocket" })).toEqual({ error: "icon must be one of the predefined icons" });
    expect(presets.sanitizeBranding({ icon: "fa-solid fa-rocket" })).toEqual({ error: "icon must be one of the predefined icons" });
  });
});

describe("agri-academy unit-presets — sanitizeBranding (composition)", () => {
  it("returns only the provided fields so it composes with a partial PATCH", () => {
    const result = presets.sanitizeBranding({ color: "#123456", icon: "leaf" });
    expect(result).toEqual({ value: { color: "#123456", icon: "leaf" } });
    expect(result.value).not.toHaveProperty("tags");
  });

  it("short-circuits on the first invalid field", () => {
    const result = presets.sanitizeBranding({ tags: ["ok"], color: "not-a-hex" });
    expect(result).toEqual({ error: "color must be a hex value like #3fae6b" });
  });
});
