import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";

// Import the app without starting the server
const app = require("../api/index.js");

describe("API Endpoints", () => {
  it("GET /api should return API information", async () => {
    const res = await request(app).get("/api");
    expect(res.status, `API info endpoint should return 200 status. Response: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body, `API info response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
      "success",
      true,
    );
  });

  it("GET /api/v1 should return v1 endpoints", async () => {
    const res = await request(app).get("/api/v1");
    expect(res.status, `V1 endpoints should return 200 status. Response: ${JSON.stringify(res.body)}`).toBe(200);
  });
});

describe("Healthcheck API", () => {
  it("GET /api/v1 should return healthcheck data", async () => {
    const res = await request(app).get("/api/v1");
    expect(res.status, `Healthcheck endpoint should return 200 status. Response: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body, `Healthcheck response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
      "success",
      true,
    );
    expect(res.body.data, `Healthcheck response should have data property. Response: ${JSON.stringify(res.body)}`).toHaveProperty("status");
    expect(
      ["healthy", "degraded"],
      `Healthcheck status should be either healthy or degraded. Response: ${JSON.stringify(res.body)}`,
    ).toContain(res.body.data.status);
  });

  it("GET /api/v1/healthcheck should return health data", async () => {
    const res = await request(app).get("/api/v1/healthcheck");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.data).toHaveProperty("status");
    expect(["healthy", "degraded"]).toContain(res.body.data.status);
  });

  it("GET /api/v1/health should return health data", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.data).toHaveProperty("status");
    expect(["healthy", "degraded"]).toContain(res.body.data.status);
  });

  it("GET /api/v1/health/databases should return database status", async () => {
    const res = await request(app).get("/api/v1/health/databases");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.data).toHaveProperty("instances");
    expect(res.body.data).toHaveProperty("status");
    expect(res.body.data).toHaveProperty("health");
    expect(res.body.data).toHaveProperty("validation");
  });

  it("GET /api/v1/health/memory should return memory stats", async () => {
    const res = await request(app).get("/api/v1/health/memory");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body.data).toHaveProperty("memoryUsage");
    expect(res.body.data).toHaveProperty("uptime");
  });
});
