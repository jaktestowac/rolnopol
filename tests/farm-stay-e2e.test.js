import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// End-to-end over the real wire across all five services:
//   host lists a property → guest searches → holds → (price changes) → confirms
//   with acceptQuote → stay completes (clock) → guest reviews → duplicate rejected.
let eco;
const HOST = "host-alice";
const GUEST = "guest-bob";
const FROM = "2030-06-10";
const TO = "2030-06-13";
let propertyId;
let bookingId;
let heldTotal;
let currentTotal;

beforeAll(async () => {
  eco = await startEcosystem({ base: 4420, tag: "e2e" });
});

afterAll(async () => {
  delete process.env.FARM_STAY_TIME_OFFSET_MS;
  if (eco) await eco.stop();
});

const app = () => eco.app;

describe("farm-stay — full lifecycle", () => {
  it("host creates a listing", async () => {
    const res = await request(app())
      .post("/v1/properties")
      .set("x-stay-user", HOST)
      .send({ name: "Alice's Orchard Cottage", district: "Kraków", type: "cottage", capacity: 4, basePrice: 100, policy: "moderate" })
      .expect(201);
    expect(res.body.host_id).toBe(HOST);
    propertyId = res.body.id;

    const mine = await request(app()).get("/v1/properties/mine").set("x-stay-user", HOST).expect(200);
    expect(mine.body.properties.map((p) => p.id)).toContain(propertyId);
  });

  it("guest finds it in search with a quote and a (zero) score", async () => {
    const res = await request(app()).get(`/v1/search?from=${FROM}&to=${TO}&guests=2`).set("x-stay-user", GUEST).expect(200);
    const mine = res.body.results.find((r) => r.id === propertyId);
    expect(mine).toBeDefined();
    expect(mine.quoteStatus).toBe("ok");
    expect(mine.quote.total).toBeGreaterThan(0);
    expect(mine.score).toEqual({ propertyId, avgRating: 0, count: 0 });
    expect(mine.isOwn).toBe(false);
  });

  it("guest holds the dates", async () => {
    const res = await request(app())
      .post("/v1/bookings")
      .set("x-stay-user", GUEST)
      .send({ propertyId, from: FROM, to: TO, guests: 2 })
      .expect(201);
    bookingId = res.body.bookingId;
    heldTotal = res.body.quote.total;
    expect(res.body.state).toBe("hold");
    expect(heldTotal).toBeGreaterThan(0);
  });

  it("host raises the price → confirm returns 409 PRICE_CHANGED", async () => {
    await request(app()).patch(`/v1/properties/${propertyId}`).set("x-stay-user", HOST).send({ basePrice: 200 }).expect(200);

    const res = await request(app()).post(`/v1/bookings/${bookingId}/confirm`).set("x-stay-user", GUEST).send({}).expect(409);
    expect(res.body.error).toBe("PRICE_CHANGED");
    expect(res.body.heldQuote).toBeCloseTo(heldTotal, 5);
    expect(res.body.currentQuote).toBeGreaterThan(res.body.heldQuote);
    currentTotal = res.body.currentQuote;
  });

  it("guest accepts the new quote → confirmed", async () => {
    const res = await request(app())
      .post(`/v1/bookings/${bookingId}/confirm`)
      .set("x-stay-user", GUEST)
      .send({ acceptQuote: currentTotal })
      .expect(200);
    expect(res.body.booking.state).toBe("confirmed");
    expect(res.body.quote.total).toBeCloseTo(currentTotal, 5);
  });

  it("stay auto-completes once the clock passes checkout", async () => {
    process.env.FARM_STAY_TIME_OFFSET_MS = String(Date.parse("2030-07-01T00:00:00Z") - Date.now());
    const res = await request(app()).get(`/v1/bookings/${bookingId}`).set("x-stay-user", GUEST).expect(200);
    expect(res.body.booking.state).toBe("completed");
  });

  it("guest reviews the completed stay, and a duplicate is rejected", async () => {
    await request(app())
      .post(`/v1/bookings/${bookingId}/review`)
      .set("x-stay-user", GUEST)
      .send({ rating: 5, text: "Wonderful orchard stay" })
      .expect(201);

    await request(app()).post(`/v1/bookings/${bookingId}/review`).set("x-stay-user", GUEST).send({ rating: 4, text: "again" }).expect(409);

    const reviews = await request(app()).get(`/v1/properties/${propertyId}/reviews`).set("x-stay-user", GUEST).expect(200);
    expect(reviews.body.total).toBe(1);
    expect(reviews.body.reviews[0].rating).toBe(5);
    delete process.env.FARM_STAY_TIME_OFFSET_MS;
  });

  it("guest 'your travel' summary reflects the completed stay (real wire)", async () => {
    process.env.FARM_STAY_TIME_OFFSET_MS = String(Date.parse("2030-07-01T00:00:00Z") - Date.now());
    const res = await request(app()).get("/v1/guest/travel").set("x-stay-user", GUEST).expect(200);
    expect(res.body.totals.trips).toBe(1);
    expect(res.body.totals.completed).toBe(1);
    expect(res.body.totals.nights).toBe(3); // 2030-06-10 → 06-13
    expect(res.body.favouriteRegion).toBe("Kraków");
    delete process.env.FARM_STAY_TIME_OFFSET_MS;
  });

  it("platform analytics aggregates across all data via role=all + include_inactive (real wire)", async () => {
    process.env.FARM_STAY_TIME_OFFSET_MS = String(Date.parse("2030-07-01T00:00:00Z") - Date.now());
    // ADMIN_USERS is unset in the harness → the gate is open (dev default).
    const res = await request(app()).get("/v1/platform/analytics").set("x-stay-user", "any-admin").expect(200);
    // Reservations start empty, so booking-derived metrics are exact: only our
    // one confirmed→completed stay. Property-derived counts (hosts/listings)
    // also include inventory's self-seeded demo catalog.
    expect(res.body.totals.incomeBookings).toBe(1);
    expect(res.body.totals.gmv).toBeGreaterThan(0);
    expect(res.body.totals.guestHeadcount).toBe(2);
    expect(res.body.totals.distinctGuests).toBe(1);
    expect(res.body.totals.hosts).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.listings).toBeGreaterThanOrEqual(1);
    expect(res.body.byDistrict.find((d) => d.district === "Kraków")).toBeDefined();
    delete process.env.FARM_STAY_TIME_OFFSET_MS;
  });
});
