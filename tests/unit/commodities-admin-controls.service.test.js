import adminControls from "../../services/commodities-admin-controls.service.js";
import { describe, it, expect, afterEach } from "vitest";

const pricingService = require("../../services/commodities-pricing.service.js");

describe("commodities-admin-controls.service", () => {
  afterEach(() => {
    // The service holds a shared in-memory Map, so reset every symbol back to
    // its permissive default after each mutating test.
    for (const control of adminControls.getAllControls()) {
      adminControls.updateControl(control.symbol, { enabled: true, maxOrderQuantity: 1000000, note: "" });
    }
  });

  it("initializes one control per supported symbol", () => {
    const controls = adminControls.getAllControls();
    expect(controls.length).toBe(pricingService.getSupportedSymbols().length);
    expect(controls.every((c) => c.enabled === true)).toBe(true);
  });

  it("resolves a control by (normalized) symbol and rejects unknown symbols", () => {
    const symbol = pricingService.getSupportedSymbols()[0];
    expect(adminControls.getControl(symbol.toLowerCase())).toMatchObject({ symbol });
    // Unknown symbols are rejected by the pricing service's normalizer.
    expect(() => adminControls.getControl("NOT_A_SYMBOL")).toThrow("unsupported commodity symbol");
  });

  describe("updateControl", () => {
    it("rejects an unsupported symbol", () => {
      expect(() => adminControls.updateControl("NOPE", { enabled: false })).toThrow("unsupported commodity symbol");
    });

    it("rejects an empty payload", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      expect(() => adminControls.updateControl(symbol, {})).toThrow("at least one control field is required");
    });

    it("rejects a non-positive maxOrderQuantity", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      expect(() => adminControls.updateControl(symbol, { maxOrderQuantity: 0 })).toThrow("must be a positive number");
    });

    it("toggles enabled, caps note length and stamps metadata", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      const updated = adminControls.updateControl(symbol, { enabled: false, note: "x".repeat(400) });
      expect(updated.enabled).toBe(false);
      expect(updated.note).toHaveLength(300);
      expect(updated.updatedBy).toBe("admin");
      expect(typeof updated.updatedAt).toBe("string");
    });
  });

  describe("validateTrade", () => {
    it("passes for an enabled symbol within the order limit", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      expect(() => adminControls.validateTrade(symbol, 10)).not.toThrow();
    });

    it("throws when trading is halted", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      adminControls.updateControl(symbol, { enabled: false });
      expect(() => adminControls.validateTrade(symbol, 1)).toThrow("Trading is halted");
    });

    it("throws when the quantity exceeds the max order limit", () => {
      const symbol = pricingService.getSupportedSymbols()[0];
      adminControls.updateControl(symbol, { maxOrderQuantity: 5 });
      expect(() => adminControls.validateTrade(symbol, 6)).toThrow("exceeds max order limit");
    });

    it("throws for an unsupported symbol", () => {
      expect(() => adminControls.validateTrade("NOPE", 1)).toThrow("unsupported commodity symbol");
    });
  });
});
