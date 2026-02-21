import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("Authorization API", () => {
  let authToken;
  let userId;
  let testUser;

  beforeEach(async () => {
    // Create a fresh test user for each test to avoid conflicts
    testUser = {
      email: `authortestuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
      displayedName: "TestUser_1",
      password: "testpass123",
    };

    let registerRes, loginRes;
    try {
      registerRes = await request(app).post("/api/v1/register").send(testUser);

      if (registerRes.status === 201 && registerRes.body.data && registerRes.body.data.token) {
        authToken = registerRes.body.data.token;
        userId = registerRes.body.data.user.id;
      } else {
        loginRes = await request(app).post("/api/v1/login").send({
          email: testUser.email,
          password: testUser.password,
        });
        if (loginRes.status === 200 && loginRes.body.data && loginRes.body.data.token) {
          authToken = loginRes.body.data.token;
          userId = loginRes.body.data.user.id;
        }
      }
    } catch (error) {
      console.error("Failed to setup test user:", error);
    }
    if (!authToken) {
      console.error("Registration response:", registerRes && registerRes.status, registerRes && registerRes.body);
      console.error("Login response:", loginRes && loginRes.status, loginRes && loginRes.body);
      throw new Error("authToken was not set during test setup. Registration or login failed.");
    }
  });

  describe("Token Validation", () => {
    it("GET /api/v1/authorization should validate token and return user data", async () => {
      const res = await request(app).get("/api/v1/authorization").set("token", authToken).expect(200);

      expect(res.body, `Authorization response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true,
      );
      expect(res.body.data, `Authorization response should have user data. Response: ${JSON.stringify(res.body)}`).toHaveProperty("id");
      expect(res.body.data, `User should have correct id. Response: ${JSON.stringify(res.body)}`).toHaveProperty("id", userId);
      expect(res.body.data, `User should have correct email. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "email",
        testUser.email,
      );
      expect(res.body.data, `User should have correct displayedName. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "displayedName",
        testUser.displayedName,
      );
    });

    it("GET /api/v1/authorization should reject without token", async () => {
      const res = await request(app).get("/api/v1/authorization").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false,
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("GET /api/v1/authorization should reject invalid token", async () => {
      const res = await request(app).get("/api/v1/authorization").set("token", "invalid-token").expect(403);

      expect(res.body, `Invalid token should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Invalid token should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("GET /api/v1/authorization should authenticate via rolnopolToken cookie", async () => {
      const res = await request(app)
        .get("/api/v1/authorization")
        .set("Cookie", [`rolnopolToken=${authToken}`])
        .expect(200);

      expect(res.body).toHaveProperty("success", true);
      expect(res.body.data).toHaveProperty("id", userId);
      expect(res.body.data).toHaveProperty("email", testUser.email);
    });
  });

  describe("Token Validation via POST", () => {
    it("POST /api/v1/authorization should validate token in body", async () => {
      const res = await request(app).post("/api/v1/authorization").send({ token: authToken }).expect(200);

      expect(res.body, `Token validation response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true,
      );
      expect(res.body.data, `Token validation response should have user data. Response: ${JSON.stringify(res.body)}`).toHaveProperty("id");
      expect(res.body.data, `User should have correct id. Response: ${JSON.stringify(res.body)}`).toHaveProperty("id", userId);
      expect(res.body.data, `User should have correct email. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "email",
        testUser.email,
      );
    });

    it("POST /api/v1/authorization should reject without token in body", async () => {
      const res = await request(app).post("/api/v1/authorization").send({}).expect(401);

      expect(res.body, `Missing token should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Missing token should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(res.body.error, `Error message should mention token required. Response: ${JSON.stringify(res.body)}`).toContain(
        "Token required",
      );
    });

    it("POST /api/v1/authorization should reject invalid token in body", async () => {
      const res = await request(app).post("/api/v1/authorization").send({ token: "invalid-token" }).expect(401);

      expect(res.body, `Invalid token should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Invalid token should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(res.body.error, `Error message should mention invalid token. Response: ${JSON.stringify(res.body)}`).toContain(
        "Invalid or expired token",
      );
    });

    it("POST /api/v1/authorization should reject malformed token", async () => {
      const res = await request(app).post("/api/v1/authorization").send({ token: "malformed-token-format" }).expect(401);

      expect(res.body, `Malformed token should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Malformed token should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Migration Endpoints", () => {
    it("POST /api/v1/migration/clear-tokens should clear all tokens", async () => {
      const res = await request(app).post("/api/v1/migration/clear-tokens").expect(200);

      expect(res.body, `Clear tokens should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", true);
      // Check if data exists before accessing its properties
      if (res.body.data) {
        expect(res.body.data, `Clear tokens should have message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("message");
        expect(res.body.data, `Clear tokens should have clearedCount. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
          "clearedCount",
        );
        expect(res.body.data.message, `Message should mention tokens cleared. Response: ${JSON.stringify(res.body)}`).toContain(
          "cleared successfully",
        );
      }
    });

    it("POST /api/v1/migration/clear-tokens should work multiple times", async () => {
      // First call
      const res1 = await request(app).post("/api/v1/migration/clear-tokens").expect(200);

      expect(res1.body, `First clear tokens should have success property. Response: ${JSON.stringify(res1.body)}`).toHaveProperty(
        "success",
        true,
      );

      // Second call
      const res2 = await request(app).post("/api/v1/migration/clear-tokens").expect(200);

      expect(res2.body, `Second clear tokens should have success property. Response: ${JSON.stringify(res2.body)}`).toHaveProperty(
        "success",
        true,
      );
      // Check if data exists before accessing its properties
      if (res2.body.data) {
        expect(res2.body.data, `Second clear tokens should have clearedCount. Response: ${JSON.stringify(res2.body)}`).toHaveProperty(
          "clearedCount",
        );
      }
    });
  });

  describe("Token Refresh and Validation Flow", () => {
    it("Should maintain token validity across multiple validations", async () => {
      // First validation
      const res1 = await request(app).get("/api/v1/authorization").set("token", authToken).expect(200);

      expect(res1.body, `First validation should have success property. Response: ${JSON.stringify(res1.body)}`).toHaveProperty(
        "success",
        true,
      );

      // Second validation
      const res2 = await request(app).get("/api/v1/authorization").set("token", authToken).expect(200);

      expect(res2.body, `Second validation should have success property. Response: ${JSON.stringify(res2.body)}`).toHaveProperty(
        "success",
        true,
      );

      // Both should return the same user data
      expect(res1.body.data.id, `Both validations should return same user ID. Response: ${JSON.stringify(res1.body)}`).toBe(
        res2.body.data.id,
      );
      expect(res1.body.data.email, `Both validations should return same email. Response: ${JSON.stringify(res1.body)}`).toBe(
        res2.body.data.email,
      );
    });

    it("Should handle mixed GET and POST validation methods", async () => {
      // GET validation
      const getRes = await request(app).get("/api/v1/authorization").set("token", authToken).expect(200);

      expect(getRes.body, `GET validation should have success property. Response: ${JSON.stringify(getRes.body)}`).toHaveProperty(
        "success",
        true,
      );

      // POST validation
      const postRes = await request(app).post("/api/v1/authorization").send({ token: authToken }).expect(200);

      expect(postRes.body, `POST validation should have success property. Response: ${JSON.stringify(postRes.body)}`).toHaveProperty(
        "success",
        true,
      );

      // Both should return the same user data
      expect(getRes.body.data.id, `Both methods should return same user ID. Response: ${JSON.stringify(getRes.body)}`).toBe(
        postRes.body.data.id,
      );
      expect(getRes.body.data.email, `Both methods should return same email. Response: ${JSON.stringify(getRes.body)}`).toBe(
        postRes.body.data.email,
      );
    });
  });

  describe("Error Handling", () => {
    it("Should handle server errors gracefully", async () => {
      // This test would require mocking the auth service to throw an error
      // For now, we'll test the basic error response structure
      const res = await request(app).get("/api/v1/authorization").set("token", "invalid-token").expect(403);

      expect(res.body, `Error response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false,
      );
      expect(res.body, `Error response should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(typeof res.body.error, `Error should be a string. Response: ${JSON.stringify(res.body)}`).toBe("string");
    });

    it("Should handle malformed requests", async () => {
      const res = await request(app).post("/api/v1/authorization").send("invalid-json").set("Content-Type", "application/json").expect(500);

      // The request should fail due to malformed JSON
      expect(res.status, `Malformed JSON should return 500 status. Response: ${JSON.stringify(res.body)}`).toBe(500);
    });
  });
});
