import { describe, test, expect } from "vitest";
import fc from "fast-check";
const pricing = require("../../services/commodities-pricing.service");

describe("CommoditiesPricingService property-based tests", () => {
  test("_toUnitInterval returns values between 0 and 1 inclusive", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const value = pricing._toUnitInterval(text);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }),
    );
  });

  test("_fnv1a32 is deterministic and 32-bit unsigned", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const hash1 = pricing._fnv1a32(text);
        const hash2 = pricing._fnv1a32(text);
        expect(hash1).toBe(hash2);
        expect(Number.isInteger(hash1)).toBe(true);
        expect(hash1).toBeGreaterThanOrEqual(0);
        expect(hash1).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });

  test("_gaussianPulse yields 1 at distance 0 and decreases with distance", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true }),
        (distance, widthHours) => {
          const center = pricing._gaussianPulse(0, widthHours);
          const near = pricing._gaussianPulse(distance, widthHours);
          expect(center).toBeCloseTo(1, 6);
          expect(near).toBeGreaterThanOrEqual(0);
          expect(near).toBeLessThanOrEqual(center);
        },
      ),
    );
  });

  test("_priceAtHourBucket is deterministic and finite", () => {
    const symbolArb = fc.constantFrom(...pricing.getSupportedSymbols());
    const hourBucketArb = fc.integer({ min: -100000, max: 100000 });
    fc.assert(
      fc.property(symbolArb, hourBucketArb, (symbol, hourBucket) => {
        const price1 = pricing._priceAtHourBucket(symbol, hourBucket);
        const price2 = pricing._priceAtHourBucket(symbol, hourBucket);
        expect(Number.isFinite(price1)).toBe(true);
        expect(price1).toBeGreaterThan(0);
        expect(price1).toBe(price2);
      }),
    );
  });

  test("_computeVolatilityRatio is non-negative", () => {
    const symbolArb = fc.constantFrom(...pricing.getSupportedSymbols());
    const hourBucketArb = fc.integer({ min: -100000, max: 100000 });

    fc.assert(
      fc.property(symbolArb, hourBucketArb, (symbol, hourBucket) => {
        const ratio = pricing._computeVolatilityRatio(symbol, hourBucket);
        expect(ratio).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(ratio)).toBe(true);
      }),
    );
  });
});
