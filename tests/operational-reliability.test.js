import { describe, it, expect, vi } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Operational reliability regressions", () => {
  it("serves /api/v1/metrics with Prometheus content-type and stable HELP/TYPE sections", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body?.data?.flags || {};

    try {
      await request(app)
        .patch("/api/v1/feature-flags")
        .send({ flags: { prometheusMetricsEnabled: true } })
        .expect(200);

      await request(app).get("/api/v1/healthcheck").expect(200);
      const res = await request(app).get("/api/v1/metrics").expect(200);

      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.headers["content-type"]).toContain("version=0.0.4");
      expect(res.headers["content-type"]).toContain("charset=utf-8");
      expect(res.text).toContain("# HELP rolnopol_http_requests_total");
      expect(res.text).toContain("# TYPE rolnopol_http_requests_total counter");
      expect(res.text).toContain("# HELP rolnopol_http_request_duration_seconds");
      expect(res.text).toContain("# TYPE rolnopol_http_request_duration_seconds histogram");
      expect(res.text.endsWith("\n")).toBe(true);
    } finally {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("keeps registration idempotent on duplicate payload: first creates, second conflicts without extra user", async () => {
    const userDataSingleton = require("../data/user-data-singleton").getInstance();
    const baselineCount = await userDataSingleton.getUserCount();

    const payload = {
      email: `idempotent_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
      displayedName: "Idempotent User",
      password: "StrongPass1!",
    };

    const first = await request(app).post("/api/v1/register").send(payload).expect(201);
    expect(first.body?.success).toBe(true);

    const afterFirst = await userDataSingleton.getUserCount();
    expect(afterFirst).toBeGreaterThanOrEqual(baselineCount + 1);

    const second = await request(app).post("/api/v1/register").send(payload).expect(409);
    expect(second.body?.success).toBe(false);
    expect(second.body?.error).toContain("already exists");

    const afterSecond = await userDataSingleton.getUserCount();
    expect(afterSecond).toBe(afterFirst);
  });

  it("returns 500 error payload when healthcheck data builder throws", async () => {
    const dbManager = require("../data/database-manager");
    const validateSpy = vi.spyOn(dbManager, "validateAll").mockRejectedValueOnce(new Error("synthetic healthcheck failure"));

    const res = await request(app).get("/api/v1/healthcheck").expect(500);

    expect(res.body).toHaveProperty("success", false);
    expect(res.body).toHaveProperty("error", "Health check failed");

    validateSpy.mockRestore();
  });

  it("enforces middleware boundaries: unsupported version is rejected, and valid version keeps version/rate-limit headers on id-validation failure", async () => {
    const unsupported = await request(app).get("/api/v999/healthcheck").expect(400);

    expect(unsupported.body).toHaveProperty("success", false);
    expect(unsupported.body?.error).toContain("Unsupported API version");

    const registerPayload = {
      email: `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
      displayedName: "Boundary User",
      password: "StrongPass1!",
    };

    const registerRes = await request(app).post("/api/v1/register").send(registerPayload).expect(201);
    const token = registerRes.body?.data?.token;
    expect(token).toBeTruthy();

    const invalidId = await request(app).put("/api/v1/users/not-a-number").set("token", token).send({ displayedName: "Nope" }).expect(400);

    expect(invalidId.body).toHaveProperty("success", false);
    expect(invalidId.body?.error).toContain("Invalid userId format");
    expect(invalidId.headers["x-api-version"]).toBe("v1");
    expect(invalidId.headers["ratelimit-limit"]).toBeDefined();
  });
});
