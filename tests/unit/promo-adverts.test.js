import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// require the module under test; our helper functions are exported when running in Node
const { getDelayMs } = require("../../public/js/components/promo-adverts.js");

describe("promo-adverts delay logic", () => {
  beforeEach(() => {
    // restore real timers/random after each test
    vi.useRealTimers();
  });

  it("returns default 3000ms when config is missing or empty", () => {
    expect(getDelayMs(null)).toBe(3000);
    expect(getDelayMs(undefined)).toBe(3000);
    expect(getDelayMs({})).toBe(3000);
  });

  it("uses fixed delaySeconds when provided", () => {
    expect(getDelayMs({ delaySeconds: 1 })).toBe(1000);
    expect(getDelayMs({ delaySeconds: 2.5 })).toBe(2500);
  });

  it("uses random value between min and max (inclusive)", () => {
    // force Math.random to return 0 and 1 to test boundaries
    vi.spyOn(Math, "random").mockReturnValueOnce(0);
    expect(getDelayMs({ minDelaySeconds: 2, maxDelaySeconds: 5 })).toBe(2000);

    vi.spyOn(Math, "random").mockReturnValueOnce(1);
    expect(getDelayMs({ minDelaySeconds: 2, maxDelaySeconds: 5 })).toBe(5000);
  });

  it("handles when min > max by swapping internally", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // if min>max it should still compute a sensible mid value between the two
    const ms = getDelayMs({ minDelaySeconds: 5, maxDelaySeconds: 1 });
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("prefers range over fixed delay when both are specified", () => {
    // when both delaySeconds and range exist, the range should take priority
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(getDelayMs({ delaySeconds: 1, minDelaySeconds: 2, maxDelaySeconds: 3 })).toBe(2000);
  });
});
