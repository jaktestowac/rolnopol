import { describe, it, expect } from "vitest";

const pricingService = require("../../services/commodities-pricing.service");

describe("CommoditiesPricingService", () => {
  it("returns deterministic price for same symbol and hour", () => {
    const fixedTimeA = new Date("2026-02-27T10:10:15.000Z");
    const fixedTimeB = new Date("2026-02-27T10:55:59.000Z");

    const first = pricingService.getCurrentPrice("gold", fixedTimeA);
    const second = pricingService.getCurrentPrice("GOLD", fixedTimeB);

    expect(first.hourBucket).toBe(second.hourBucket);
    expect(first.price).toBe(second.price);
    expect(first.hourStartUtc).toBe(second.hourStartUtc);
  });

  it("returns plausible long-cycle history with exact requested length", () => {
    const history = pricingService.getPriceHistory("SILVER", 240, new Date("2026-02-27T12:00:00.000Z"));

    expect(history.symbol).toBe("SILVER");
    expect(history.hours).toBe(240);
    expect(Array.isArray(history.points)).toBe(true);
    expect(history.points).toHaveLength(240);

    const prices = history.points.map((p) => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    expect(minPrice).toBeGreaterThan(0);
    expect(maxPrice).toBeGreaterThan(minPrice);
  });

  it("throws for invalid symbol", () => {
    expect(() => pricingService.getCurrentPrice("WOOD")).toThrow(/unsupported commodity symbol/i);
  });

  it("supports minimum and maximum history windows", () => {
    const minHistory = pricingService.getPriceHistory("GOLD", 12, new Date("2026-02-27T12:00:00.000Z"));
    const maxHistory = pricingService.getPriceHistory("GOLD", 720, new Date("2026-02-27T12:00:00.000Z"));

    expect(minHistory.points).toHaveLength(12);
    expect(maxHistory.points).toHaveLength(720);
  });

  it("throws when history window is outside supported bounds", () => {
    expect(() => pricingService.getPriceHistory("GOLD", 11)).toThrow(/between 12 and 720/i);
    expect(() => pricingService.getPriceHistory("GOLD", 721)).toThrow(/between 12 and 720/i);
  });

  it("returns realistic execution quote with sell below mid and buy above mid", () => {
    const quote = pricingService.getExecutionQuote("GOLD", "sell", 2.5, new Date("2026-02-27T12:00:00.000Z"));

    expect(quote.symbol).toBe("GOLD");
    expect(quote.midPrice).toBeGreaterThan(0);
    expect(quote.buyPrice).toBeGreaterThan(quote.midPrice);
    expect(quote.sellPrice).toBeLessThan(quote.midPrice);
    expect(quote.executionPrice).toBe(quote.sellPrice);
    expect(quote.spreadPct).toBeGreaterThan(0);
  });

  it("applies larger liquidity impact for larger trade sizes", () => {
    const time = new Date("2026-02-27T12:00:00.000Z");
    const small = pricingService.getExecutionQuote("SILVER", "buy", 1, time);
    const large = pricingService.getExecutionQuote("SILVER", "buy", 500, time);

    expect(large.liquidityImpactPct).toBeGreaterThanOrEqual(small.liquidityImpactPct);
    expect(large.buyPrice).toBeGreaterThanOrEqual(small.buyPrice);
  });

  it("simulates occasional dramatic moves in long histories", () => {
    const history = pricingService.getPriceHistory("MARKER_FRAGMENT", 720, new Date("2026-02-27T12:00:00.000Z"));
    const prices = history.points.map((point) => Number(point.price || 0));

    const maxMovePct = prices.slice(1).reduce((maxMove, current, index) => {
      const previous = prices[index];
      if (previous <= 0) return maxMove;
      const movePct = Math.abs((current - previous) / previous);
      return Math.max(maxMove, movePct);
    }, 0);

    expect(maxMovePct).toBeGreaterThan(0.04);
  });
});
