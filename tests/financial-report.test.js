import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Financial Report endpoint", () => {
  it("GET /api/v1/financial/report is gated by financialReportsEnabled flag", async () => {
    // Save original flags
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    // Ensure flag is disabled
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { financialReportsEnabled: false } })
      .expect(200);

    // Register a new user and get token
    const testUser = {
      email: `report_test_${Date.now()}@test.com`,
      displayedName: "Report Test",
      password: "reportpass123",
    };

    const reg = await request(app).post("/api/v1/register").send(testUser).expect(201);
    const token = reg.body.data.token;

    // When flag is disabled, endpoint should return 404
    const resDisabled = await request(app).get("/api/v1/financial/report").set("token", token).expect(404);

    expect(resDisabled.body.success).toBe(false);
    expect(resDisabled.body.error).toContain("Financial report not found");

    // Enable flag
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { financialReportsEnabled: true } })
      .expect(200);

    // Now request should succeed
    const resEnabled = await request(app).get("/api/v1/financial/report").set("token", token).expect(200);

    expect(resEnabled.body.success).toBe(true);
    expect(resEnabled.body.data).toHaveProperty("encodedReport");
    expect(typeof resEnabled.body.data.encodedReport).toBe("string");

    // Restore original flags
    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });
});
