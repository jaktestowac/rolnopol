import { describe, it, expect } from "vitest";
const path = require("path");

process.env.FARM_STAY_LOG = "silent";

const FS = path.join(__dirname, "..", "..", "external-services", "farm-stay", "pricing-service");
const { quote, round2 } = require(path.join(FS, "server", "handlers.js"));
const { COUPONS, normalizeCode, findCoupon, applyCoupon } = require(path.join(FS, "config", "coupons.js"));

const FROM = "2030-06-10"; // 2 nights, June (high season) — no long-stay discount
const TO = "2030-06-12";
const LONG_FROM = "2030-03-04"; // 7 nights (mid) — triggers long-stay discount
const LONG_TO = "2030-03-11";

describe("farm-stay coupons — config helpers", () => {
  it("normalizes codes: trims + upper-cases", () => {
    expect(normalizeCode("  welcome10 ")).toBe("WELCOME10");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode(null)).toBe("");
  });

  it("resolves known / unknown / empty codes", () => {
    expect(findCoupon("welcome10")).toEqual({ code: "WELCOME10", def: COUPONS.WELCOME10 });
    expect(findCoupon("nope")).toEqual({ code: "NOPE", error: "COUPON_NOT_FOUND" });
    expect(findCoupon("")).toBeNull();
  });

  it("applyCoupon caps the discount at the subtotal (never negative total)", () => {
    const outcome = applyCoupon("SPRING25", 10, 3, round2); // fixed 25 off a 10 subtotal
    expect(outcome.applied).toBe(true);
    expect(outcome.amount).toBe(10);
  });
});

describe("farm-stay coupons — quote() integration", () => {
  it("is still deterministic with a coupon applied", () => {
    const a = quote({ basePrice: 137, from: FROM, to: TO, coupon: "WELCOME10" });
    const b = quote({ basePrice: 137, from: FROM, to: TO, coupon: "welcome10" }); // case-insensitive
    expect(a).toEqual(b);
  });

  it("applies a percentage coupon on top of the running total", () => {
    const base = quote({ basePrice: 100, from: FROM, to: TO });
    const withCoupon = quote({ basePrice: 100, from: FROM, to: TO, coupon: "WELCOME10" });
    const expectedAmount = round2(base.total * 0.1);
    expect(withCoupon.coupon).toMatchObject({ code: "WELCOME10", applied: true, amount: expectedAmount });
    expect(withCoupon.total).toBe(round2(base.total - expectedAmount));
    expect(withCoupon.discounts.some((d) => d.code === "coupon:WELCOME10")).toBe(true);
  });

  it("applies a fixed coupon after the long-stay discount", () => {
    const base = quote({ basePrice: 100, from: LONG_FROM, to: LONG_TO }); // has long_stay discount
    expect(base.discounts.some((d) => d.code === "long_stay")).toBe(true);
    const withCoupon = quote({ basePrice: 100, from: LONG_FROM, to: LONG_TO, coupon: "SPRING25" });
    expect(withCoupon.coupon.applied).toBe(true);
    expect(withCoupon.total).toBe(round2(base.total - 25));
  });

  it("rejects an unknown code: quote is unchanged, error surfaced", () => {
    const base = quote({ basePrice: 100, from: FROM, to: TO });
    const q = quote({ basePrice: 100, from: FROM, to: TO, coupon: "NOPE" });
    expect(q.total).toBe(base.total);
    expect(q.coupon).toMatchObject({ code: "NOPE", applied: false, error: "COUPON_NOT_FOUND" });
    expect(q.discounts.some((d) => String(d.code).startsWith("coupon:"))).toBe(false);
  });

  it("enforces minNights: LONGHAUL15 needs 5 nights", () => {
    const short = quote({ basePrice: 100, from: FROM, to: TO, coupon: "LONGHAUL15" }); // 2 nights
    expect(short.coupon).toMatchObject({ code: "LONGHAUL15", applied: false, error: "COUPON_MIN_NIGHTS", minNights: 5 });
    expect(short.total).toBe(quote({ basePrice: 100, from: FROM, to: TO }).total);

    const long = quote({ basePrice: 100, from: LONG_FROM, to: LONG_TO, coupon: "LONGHAUL15" }); // 7 nights
    expect(long.coupon.applied).toBe(true);
  });

  it("no coupon → no coupon field (backward compatible)", () => {
    const q = quote({ basePrice: 100, from: FROM, to: TO });
    expect(q.coupon).toBeUndefined();
  });
});
