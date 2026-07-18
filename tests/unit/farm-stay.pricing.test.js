import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");

// Stateless service — no DB. Fixed test port before requiring the app.
process.env.PRICING_PORT = "0";
process.env.FARM_STAY_LOG = "silent";

const FS = path.join(__dirname, "..", "..", "external-services", "farm-stay", "pricing-service");
const { quote, round2 } = require(path.join(FS, "server", "handlers.js"));
const { buildApp } = require(path.join(FS, "server", "index.js"));
const seasons = require(path.join(FS, "config", "seasons.js"));

// Independent oracle for a single night's price (recomputes the rules).
const SEASON_MULT = { low: 0.9, mid: 1.0, high: 1.3 };
const SEASON_BY_MONTH = {
  1: "low",
  2: "low",
  3: "mid",
  4: "mid",
  5: "mid",
  6: "high",
  7: "high",
  8: "high",
  9: "mid",
  10: "mid",
  11: "low",
  12: "high",
};
function isWeekend(date) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6;
}
function expectedNight(basePrice, date) {
  const season = SEASON_BY_MONTH[Number(date.slice(5, 7))];
  return Math.round(basePrice * SEASON_MULT[season] * (isWeekend(date) ? 1.15 : 1) * 100) / 100;
}

describe("farm-stay pricing — quote() pure logic", () => {
  it("is deterministic: same inputs → identical output", () => {
    const a = quote({ basePrice: 137, from: "2030-06-10", to: "2030-06-15" });
    const b = quote({ basePrice: 137, from: "2030-06-10", to: "2030-06-15" });
    expect(a).toEqual(b);
    expect(a.currency).toBe("ROL");
  });

  it("prices each night by season and weekend uplift", () => {
    const from = "2030-06-10"; // June → high season
    const to = "2030-06-17"; // 7 nights — spans a Fri + Sat
    const q = quote({ basePrice: 100, from, to });
    expect(q.nights).toHaveLength(7);
    for (const n of q.nights) {
      expect(n.season).toBe("high");
      expect(n.price).toBe(expectedNight(100, n.date));
      expect(n.weekend).toBe(isWeekend(n.date));
    }
    // The window includes weekend nights, which carry the uplift.
    const weekendNight = q.nights.find((n) => n.weekend);
    expect(weekendNight).toBeDefined();
    expect(weekendNight.price).toBeCloseTo(round2(100 * 1.3 * 1.15), 5);
  });

  it("assigns low/mid/high seasons at month boundaries", () => {
    expect(quote({ basePrice: 100, from: "2030-02-11", to: "2030-02-12" }).nights[0].season).toBe("low");
    expect(quote({ basePrice: 100, from: "2030-03-11", to: "2030-03-12" }).nights[0].season).toBe("mid");
    expect(quote({ basePrice: 100, from: "2030-08-11", to: "2030-08-12" }).nights[0].season).toBe("high");
    expect(quote({ basePrice: 100, from: "2030-12-11", to: "2030-12-12" }).nights[0].season).toBe("high"); // holidays
  });

  it("applies a 10% long-stay discount at 7+ nights, not at 6", () => {
    const six = quote({ basePrice: 100, from: "2030-03-04", to: "2030-03-10" }); // 6 nights (mid, all weekday-ish)
    expect(six.discounts).toHaveLength(0);
    expect(six.total).toBe(six.subtotal);

    const seven = quote({ basePrice: 100, from: "2030-03-04", to: "2030-03-11" }); // 7 nights
    expect(seven.discounts).toHaveLength(1);
    expect(seven.discounts[0].code).toBe("long_stay");
    expect(seven.total).toBe(round2(seven.subtotal - round2(seven.subtotal * 0.1)));
    expect(seven.total).toBeLessThan(seven.subtotal);
  });

  it("returns penny-exact totals (2 decimals)", () => {
    const q = quote({ basePrice: 89.99, from: "2030-06-06", to: "2030-06-13" });
    expect(Number.isInteger(Math.round(q.total * 100))).toBe(true);
    expect(q.total).toBe(round2(q.total));
  });

  it("exposes the compiled-in rules (compiled, not data)", () => {
    expect(seasons.LONG_STAY_MIN_NIGHTS).toBe(7);
    expect(seasons.WEEKEND_UPLIFT).toBe(1.15);
  });
});

describe("farm-stay pricing — REST surface", () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  it("GET /health reports SERVING and stateless", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("SERVING");
    expect(res.body.stateless).toBe(true);
  });

  it("POST /v1/quotes returns a deterministic quote", async () => {
    const res = await request(app)
      .post("/v1/quotes")
      .send({ propertyId: "p1", basePrice: 100, from: "2030-06-10", to: "2030-06-12", guests: 2 })
      .expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.currency).toBe("ROL");
    expect(res.body.nights).toHaveLength(2);
  });

  it("rejects a negative basePrice with 400", async () => {
    await request(app).post("/v1/quotes").send({ basePrice: -1, from: "2030-06-10", to: "2030-06-12" }).expect(400);
  });

  it("rejects an inverted date range with 400", async () => {
    await request(app).post("/v1/quotes").send({ basePrice: 100, from: "2030-06-12", to: "2030-06-10" }).expect(400);
  });
});
