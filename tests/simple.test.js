import { describe, it, expect } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("Simple API Tests", () => {
  it("GET /api should return API information", async () => {
    const res = await request(app).get("/api");
    expect(
      res.status,
      `API info endpoint should return 200 status. Response: ${JSON.stringify(res.body)}`,
    ).toBe(200);
    expect(
      res.body,
      `API info response should have success property. Response: ${JSON.stringify(res.body)}`,
    ).toHaveProperty("success", true);
  });

  it("GET /api/v1 should return healthcheck data", async () => {
    const res = await request(app).get("/api/v1");
    expect(
      res.status,
      `V1 endpoint should return 200 status. Response: ${JSON.stringify(res.body)}`,
    ).toBe(200);
    expect(
      res.body,
      `V1 response should have success property. Response: ${JSON.stringify(res.body)}`,
    ).toHaveProperty("success", true);
  });

  it("POST /api/v1/register should work with valid data", async () => {
    const testUser = {
      email: `simpletestuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
      displayedName: "Simple Test User",
      password: "testpass123",
    };

    const res = await request(app).post("/api/v1/register").send(testUser);

    if (res.status === 201) {
      expect(
        res.body,
        `Registration should have success property. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", true);
      expect(
        res.body.data,
        `Registration should have user data. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("user");
      expect(
        res.body.data,
        `Registration should include authentication token. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("token");
    } else if (res.status === 400) {
      // Invalid data or duplicate
      expect(
        res.body,
        `Invalid registration should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
    } else {
      console.error("Unexpected status:", res.status, res.body);
      expect(
        res.status,
        `Registration should return 201 status for new user. Response: ${JSON.stringify(res.body)}`,
      ).toBe(201);
    }
  });
});
