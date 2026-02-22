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

  it("GET /api/v1/feature-flags?descriptions=true returns grouped descriptions", async () => {
    const res = await request(app).get("/api/v1/feature-flags?descriptions=true").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("flags");
    expect(res.body.data).toHaveProperty("groups");
    expect(res.body.data.flags).toHaveProperty("messengerEnabled");
    expect(res.body.data.flags.messengerEnabled).toHaveProperty("value");
    expect(res.body.data.flags.messengerEnabled).toHaveProperty("description");
    expect(res.body.data.groups).toHaveProperty("communication");
    expect(Array.isArray(res.body.data.groups.communication)).toBe(true);
    expect(res.body.data.flags).toHaveProperty("cookieConsentBannerEnabled");
    expect(res.body.data.groups).toHaveProperty("privacy");
    expect(Array.isArray(res.body.data.groups.privacy)).toBe(true);
    expect(res.body.data.groups.privacy).toContain("cookieConsentBannerEnabled");
    // marketing group should include advert-related flags
    expect(res.body.data.flags).toHaveProperty("promoAdvertsGeneralAdEnabled");
    expect(res.body.data.groups).toHaveProperty("marketing (Ads)");
    expect(res.body.data.groups["marketing (Ads)"]).toContain("promoAdvertsGeneralAdEnabled");
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

  it("PATCH /api/v1/feature-flags rejects non-object flags payload", async () => {
    const res = await request(app).patch("/api/v1/feature-flags").send({ flags: [] }).expect(400);

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

  it("POST /api/v1/feature-flags/reset restores predefined defaults", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { messengerEnabled: true, docsSearchEnabled: true } })
      .expect(200);

    const resetRes = await request(app).post("/api/v1/feature-flags/reset").expect(200);

    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.data).toHaveProperty("flags");
    expect(resetRes.body.data.flags.messengerEnabled).toBe(false);
    expect(resetRes.body.data.flags.docsSearchEnabled).toBe(false);
    expect(resetRes.body.data.flags.alertsEnabled).toBe(true);
    expect(resetRes.body.data.flags.cookieConsentBannerEnabled).toBe(false);
  });
});
