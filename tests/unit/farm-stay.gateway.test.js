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

const { buildApp } = require(`${GW}/server/index.js`);

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
