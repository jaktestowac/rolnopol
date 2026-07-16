import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
const path = require("path");
const grpc = require("@grpc/grpc-js");

// The gateway orchestrates four leaf clients. Rather than hit the network, we
// require the real client modules and replace their methods with vi.fn() stubs
// before building the app — the gateway calls each method off the cached module
// object (e.g. `inventory.search(...)`), so patching those objects fully
// isolates this to a unit test of orchestration, shaping, error mapping, and the
// review-eligibility pre-check.
const GW = "../../external-services/farm-stay/stay-gateway-service";

const inventory = require(`${GW}/clients/inventory-client`);
const pricing = require(`${GW}/clients/pricing-client`);
const reservation = require(`${GW}/clients/reservation-client`);
const reviews = require(`${GW}/clients/review-client`);

// Replace every callable leaf method with a fresh vi.fn(). Preserves target/url.
function stubLeaves() {
  for (const mod of [inventory, pricing, reservation, reviews]) {
    for (const [key, val] of Object.entries(mod)) {
      if (typeof val === "function") mod[key] = vi.fn();
    }
  }
}
stubLeaves();

const { buildApp, buildHostingAnalytics } = require(`${GW}/server/index.js`);

let app;
const USER = "user-1";
const as = (req) => req.set("x-stay-user", USER);

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  stubLeaves();
});

describe("farm-stay gateway — identity guard", () => {
  it("rejects a /v1 request without x-stay-user (401)", async () => {
    await request(app).get("/v1/search?from=2030-06-10&to=2030-06-12").expect(401);
  });
});

describe("farm-stay gateway — search orchestration + shaping", () => {
  it("merges inventory + pricing + scores into one payload", async () => {
    inventory.search.mockResolvedValue({ properties: [{ id: "p1", host_id: "someone", base_price: 100, capacity: 4 }] });
    pricing.quote.mockResolvedValue({ total: 200, currency: "ROL" });
    reviews.scores.mockResolvedValue({ scores: [{ propertyId: "p1", avgRating: 4.5, count: 2 }] });

    const res = await as(request(app).get("/v1/search?from=2030-06-10&to=2030-06-12&guests=2")).expect(200);
    expect(res.body.total).toBe(1);
    const r = res.body.results[0];
    expect(r.quote.total).toBe(200);
    expect(r.quoteStatus).toBe("ok");
    expect(r.score).toEqual({ propertyId: "p1", avgRating: 4.5, count: 2 });
    expect(r.isOwn).toBe(false);
    expect(res.body.scoreStatus).toBe("ok");
  });

  it("degrades gracefully when pricing and review-desk are down", async () => {
    inventory.search.mockResolvedValue({ properties: [{ id: "p1", host_id: "someone", base_price: 100, capacity: 4 }] });
    pricing.quote.mockRejectedValue(Object.assign(new Error("down"), { kind: "unavailable" }));
    reviews.scores.mockRejectedValue(Object.assign(new Error("down"), { kind: "unavailable" }));

    const res = await as(request(app).get("/v1/search?from=2030-06-10&to=2030-06-12")).expect(200);
    const r = res.body.results[0];
    expect(r.quote).toBeNull();
    expect(r.quoteStatus).toBe("unavailable");
    expect(r.score).toBeNull();
    expect(res.body.scoreStatus).toBe("unavailable");
  });

  it("returns 503 when inventory (the catalog owner) is unavailable", async () => {
    inventory.search.mockRejectedValue({ code: grpc.status.UNAVAILABLE, details: "down" });
    await as(request(app).get("/v1/search?from=2030-06-10&to=2030-06-12")).expect(503);
  });

  it("maps an invalid-argument gRPC error to 400", async () => {
    inventory.search.mockRejectedValue({ code: grpc.status.INVALID_ARGUMENT, details: "bad range" });
    await as(request(app).get("/v1/search?from=bad&to=worse")).expect(400);
  });
});

describe("farm-stay gateway — booking guards", () => {
  it("refuses to let a host book their own property (409)", async () => {
    inventory.listProperties.mockResolvedValue({
      properties: [{ id: "p1", host_id: USER, capacity: 4, base_price: 100, policy: "moderate" }],
    });
    const res = await as(
      request(app).post("/v1/bookings").send({ propertyId: "p1", from: "2030-06-10", to: "2030-06-12", guests: 1 }),
    ).expect(409);
    expect(res.body.error).toMatch(/your own property/i);
    expect(inventory.hold).not.toHaveBeenCalled();
  });

  it("returns 404 for booking a property that does not exist", async () => {
    inventory.listProperties.mockResolvedValue({ properties: [] });
    await as(request(app).post("/v1/bookings").send({ propertyId: "ghost", from: "2030-06-10", to: "2030-06-12", guests: 1 })).expect(404);
  });

  it("maps a RANGE_UNAVAILABLE hold failure to 409", async () => {
    inventory.listProperties.mockResolvedValue({
      properties: [{ id: "p1", host_id: "someone", capacity: 4, base_price: 100, policy: "moderate" }],
    });
    inventory.hold.mockRejectedValue({ code: grpc.status.FAILED_PRECONDITION, details: "RANGE_UNAVAILABLE" });
    const res = await as(
      request(app).post("/v1/bookings").send({ propertyId: "p1", from: "2030-06-10", to: "2030-06-12", guests: 1 }),
    ).expect(409);
    expect(res.body.error).toBe("RANGE_UNAVAILABLE");
  });
});

describe("farm-stay gateway — review eligibility pre-check", () => {
  it("allows the guest of a completed booking to review (201)", async () => {
    reservation.getBooking.mockResolvedValue({ id: "bk1", guest_id: USER, property_id: "p1", state: "completed" });
    reviews.submitReview.mockResolvedValue({ id: "rev1", rating: 5 });
    const res = await as(request(app).post("/v1/bookings/bk1/review").send({ rating: 5, text: "great" })).expect(201);
    expect(res.body.id).toBe("rev1");
    expect(reviews.submitReview).toHaveBeenCalledWith(expect.objectContaining({ bookingId: "bk1", author: USER, propertyId: "p1" }));
  });

  it("rejects a review before the stay is completed (409 NOT_COMPLETED)", async () => {
    reservation.getBooking.mockResolvedValue({ id: "bk1", guest_id: USER, property_id: "p1", state: "confirmed" });
    const res = await as(request(app).post("/v1/bookings/bk1/review").send({ rating: 5 })).expect(409);
    expect(res.body.error).toBe("NOT_COMPLETED");
    expect(reviews.submitReview).not.toHaveBeenCalled();
  });

  it("rejects a review from someone who is not the guest (403)", async () => {
    reservation.getBooking.mockResolvedValue({ id: "bk1", guest_id: "another-guest", property_id: "p1", state: "completed" });
    await as(request(app).post("/v1/bookings/bk1/review").send({ rating: 5 })).expect(403);
    expect(reviews.submitReview).not.toHaveBeenCalled();
  });
});

describe("farm-stay gateway — hosting analytics shaping (pure)", () => {
  const properties = [{ id: "p1", name: "Barn", type: "cottage", capacity: 4, base_price: 100 }];
  const bookings = [
    { id: "b1", property_id: "p1", guest_id: "g1", from: "2030-06-10", to: "2030-06-13", guests: 2, state: "completed", quote_total: 300 },
    { id: "b2", property_id: "p1", guest_id: "g2", from: "2030-07-01", to: "2030-07-03", guests: 1, state: "confirmed", quote_total: 200 },
    { id: "b3", property_id: "p1", guest_id: "g1", from: "2030-08-01", to: "2030-08-02", guests: 1, state: "cancelled", quote_total: 100 },
  ];
  const scoresById = { p1: { propertyId: "p1", avgRating: 4, count: 2 } };

  it("aggregates income, occupancy, visitors, and per-property", () => {
    const a = buildHostingAnalytics({ properties, bookings, scoresById });
    // Only confirmed + completed count as income; cancelled is excluded.
    expect(a.totals.grossIncome).toBe(500);
    expect(a.totals.paidOut).toBe(300);
    expect(a.totals.upcoming).toBe(200);
    expect(a.totals.nightsBooked).toBe(5); // 3 + 2
    expect(a.totals.guestNights).toBe(8); // 3*2 + 2*1
    expect(a.totals.distinctVisitors).toBe(2); // g1 (completed) + g2 (confirmed)
    expect(a.totals.avgRating).toBe(4);
    expect(a.totals.listings).toBe(1);
    expect(a.stateDistribution).toEqual({ completed: 1, confirmed: 1, cancelled: 1 });

    const jun = a.incomeByMonth.find((m) => m.month === "2030-06");
    expect(jun.income).toBe(300);
    expect(jun.visitors).toBe(1);

    const y2030 = a.occupancyByYear.find((y) => y.year === "2030");
    expect(y2030.nights).toBe(5); // cancelled range not counted

    expect(a.perProperty[0].propertyId).toBe("p1");
    expect(a.perProperty[0].income).toBe(500);
    expect(a.perProperty[0].visitors).toBe(2);
  });

  it("lists idle properties at zero and marks removed ones", () => {
    const a = buildHostingAnalytics({
      properties: [{ id: "idle", name: "Empty Hut" }],
      bookings: [
        {
          id: "b9",
          property_id: "gone",
          guest_id: "g1",
          from: "2030-06-10",
          to: "2030-06-11",
          guests: 1,
          state: "completed",
          quote_total: 90,
        },
      ],
      scoresById: {},
    });
    const idle = a.perProperty.find((p) => p.propertyId === "idle");
    const gone = a.perProperty.find((p) => p.propertyId === "gone");
    expect(idle.income).toBe(0);
    expect(gone.removed).toBe(true);
    expect(gone.income).toBe(90);
  });
});

describe("farm-stay gateway — hosting analytics route", () => {
  it("fans out to inventory + reservation + scores and shapes the payload", async () => {
    inventory.listProperties.mockResolvedValue({ properties: [{ id: "p1", name: "Barn", base_price: 100, capacity: 4 }] });
    reservation.listBookings.mockResolvedValue({
      bookings: [
        {
          id: "b1",
          property_id: "p1",
          guest_id: "g1",
          from: "2030-06-10",
          to: "2030-06-12",
          guests: 2,
          state: "completed",
          quote_total: 200,
        },
      ],
    });
    reviews.scores.mockResolvedValue({ scores: [{ propertyId: "p1", avgRating: 5, count: 1 }] });

    const res = await as(request(app).get("/v1/hosting/analytics")).expect(200);
    expect(res.body.totals.grossIncome).toBe(200);
    expect(res.body.totals.avgRating).toBe(5);
    expect(res.body.perProperty[0].propertyId).toBe("p1");
    expect(reservation.listBookings).toHaveBeenCalledWith(USER, "host");
  });

  it("still returns analytics when review-desk (scores) is down", async () => {
    inventory.listProperties.mockResolvedValue({ properties: [{ id: "p1", name: "Barn" }] });
    reservation.listBookings.mockResolvedValue({ bookings: [] });
    reviews.scores.mockRejectedValue(Object.assign(new Error("down"), { kind: "unavailable" }));
    const res = await as(request(app).get("/v1/hosting/analytics")).expect(200);
    expect(res.body.totals.avgRating).toBe(0);
  });

  it("returns 503 when reservation (the booking owner) is unavailable", async () => {
    inventory.listProperties.mockResolvedValue({ properties: [] });
    reservation.listBookings.mockRejectedValue({ code: grpc.status.UNAVAILABLE, details: "down" });
    await as(request(app).get("/v1/hosting/analytics")).expect(503);
  });
});
