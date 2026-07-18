import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB before requiring the service.
const TMP_DB = path.join(os.tmpdir(), `fs-reviews-unit-${process.pid}.json`);
process.env.REVIEWS_DB_PATH = TMP_DB;
process.env.FARM_STAY_LOG = "silent";

const FS = path.join(__dirname, "..", "..", "external-services", "farm-stay", "review-desk-service");
const db = require(path.join(FS, "server", "db.js"));
const { buildApp } = require(path.join(FS, "server", "index.js"));

let app;

beforeAll(async () => {
  await db.init();
  app = buildApp();
});

afterAll(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("farm-stay review-desk — submit + guards", () => {
  it("creates a review (201)", async () => {
    const res = await request(app)
      .post("/v1/reviews")
      .send({ propertyId: "p1", bookingId: "bk-1", author: "guest-a", rating: 5, text: "Lovely" })
      .expect(201);
    expect(res.body.id).toMatch(/^rev-/);
    expect(res.body.rating).toBe(5);
  });

  it("rejects a duplicate bookingId with 409 (defense in depth)", async () => {
    await request(app)
      .post("/v1/reviews")
      .send({ propertyId: "p1", bookingId: "bk-1", author: "guest-a", rating: 4, text: "again" })
      .expect(409);
  });

  it("rejects an out-of-range rating with 400", async () => {
    await request(app).post("/v1/reviews").send({ propertyId: "p1", bookingId: "bk-x", author: "guest-a", rating: 6 }).expect(400);
  });

  it("rejects missing required fields with 400", async () => {
    await request(app).post("/v1/reviews").send({ propertyId: "p1", rating: 3 }).expect(400);
  });
});

describe("farm-stay review-desk — listing + aggregates", () => {
  beforeAll(async () => {
    // Seed a second property with two ratings to exercise the average.
    await request(app).post("/v1/reviews").send({ propertyId: "p2", bookingId: "bk-2", author: "g1", rating: 4, text: "" }).expect(201);
    await request(app).post("/v1/reviews").send({ propertyId: "p2", bookingId: "bk-3", author: "g2", rating: 5, text: "" }).expect(201);
  });

  it("lists reviews for a property, newest first", async () => {
    const res = await request(app).get("/v1/reviews?propertyId=p2").expect(200);
    expect(res.body.total).toBe(2);
    // Newest (bk-3) first.
    expect(res.body.reviews[0].bookingId).toBe("bk-3");
  });

  it("computes batch scores (avg to 1 decimal + count)", async () => {
    const res = await request(app)
      .post("/v1/scores")
      .send({ propertyIds: ["p1", "p2", "p-none"] })
      .expect(200);
    const byId = Object.fromEntries(res.body.scores.map((s) => [s.propertyId, s]));
    expect(byId.p1).toEqual({ propertyId: "p1", avgRating: 5, count: 1 });
    expect(byId.p2).toEqual({ propertyId: "p2", avgRating: 4.5, count: 2 });
    expect(byId["p-none"]).toEqual({ propertyId: "p-none", avgRating: 0, count: 0 });
  });
});
