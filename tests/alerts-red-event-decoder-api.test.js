import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Alerts Red Event Decoder easter egg", () => {
  let originalFlags;

  beforeAll(async () => {
    const flagsRes = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = flagsRes.body?.data?.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { alertsEnabled: true } })
      .expect(200);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns decoder metadata when redDecode=1", async () => {
    const seed = "2026-03-16";
    const res = await request(app).get(`/api/v1/alerts?date=${seed}&redDecode=1`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.easeterEgg).toBeUndefined();
    expect(res.body.meta.easterEgg).toBeDefined();
    expect(res.body.meta.easterEgg.id).toBe("red-event-decoder");

    const decoded = Buffer.from(res.body.meta.easterEgg.encoded, "base64").toString("utf8");
    expect(decoded).toContain(`RED-EVENT:${seed}`);
  });
});
