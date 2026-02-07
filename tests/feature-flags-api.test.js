import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Feature Flags API", () => {
  it("GET /api/v1/feature-flags returns flags", async () => {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("flags");
    expect(res.headers.etag).toBeUndefined();
  });

  it("PATCH /api/v1/feature-flags updates flags without auth", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    const res = await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { testFlagApi: true } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.flags.testFlagApi).toBe(true);
    expect(res.headers.etag).toBeUndefined();

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  it("PUT /api/v1/feature-flags replaces flags without auth", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    const res = await request(app)
      .put("/api/v1/feature-flags")
      .send({ flags: { apiPutFlag: false } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.flags).toEqual({ apiPutFlag: false });
    expect(res.headers.etag).toBeUndefined();

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  it("PATCH /api/v1/feature-flags validates payload", async () => {
    const res = await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { testFlagApi: "yes" } })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Validation failed");
    expect(res.headers.etag).toBeUndefined();
  });

  it("PATCH /api/v1/feature-flags rejects unsafe keys", async () => {
    const res = await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { __proto__: true } })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Validation failed");
    expect(res.headers.etag).toBeUndefined();
  });

  it("PUT /api/v1/feature-flags rejects unsafe keys", async () => {
    const res = await request(app)
      .put("/api/v1/feature-flags")
      .send({ flags: { constructor: true } })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Validation failed");
    expect(res.headers.etag).toBeUndefined();
  });

  it("PUT /api/v1/feature-flags allows empty flags", async () => {
    const res = await request(app).put("/api/v1/feature-flags").send({ flags: {} }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.flags).toEqual({});
    expect(res.headers.etag).toBeUndefined();
  });
});
