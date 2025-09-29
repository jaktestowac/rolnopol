import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("User Profile API", () => {
  let authToken;
  let userId;
  let testUser;

  beforeEach(async () => {
    // Create a fresh test user for each test to avoid conflicts
    testUser = {
      email: `profiletestuser_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}@test.com`,
      displayedName: "Profile Test User",
      password: "testpass123",
    };

    // Create a test user and get authentication token
    try {
      const registerRes = await request(app)
        .post("/api/v1/register")
        .send(testUser);

      if (registerRes.status === 201) {
        authToken = registerRes.body.data.token;
        userId = registerRes.body.data.user.id;
      } else {
        // User might already exist, try to login
        const loginRes = await request(app).post("/api/v1/login").send({
          email: testUser.email,
          password: testUser.password,
        });

        if (loginRes.status === 200) {
          authToken = loginRes.body.data.token;
          userId = loginRes.body.data.user.id;
        } else {
          console.error("Login failed:", loginRes.status, loginRes.body);
        }
      }
    } catch (error) {
      console.error("Failed to setup test user:", error);
    }

    // Skip tests if we don't have authentication
    if (!authToken) {
      console.warn("Skipping profile tests due to authentication failure");
    }
  });
  describe("Get User Profile", () => {
    it("GET /api/v1/users/profile should return user profile", async () => {
      const res = await request(app)
        .get("/api/v1/users/profile")
        .set("token", authToken)
        .expect(200);

      expect(
        res.body,
        `Profile response should have success property. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", true);
      expect(
        res.body.data,
        `Profile response should have user data. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("id");
      expect(
        res.body.data,
        `User should have correct id. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("id", userId);
      expect(
        res.body.data,
        `User should have correct email. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("email", testUser.email);
      expect(
        res.body.data,
        `User should have correct displayedName. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("displayedName", testUser.displayedName);
      expect(
        res.body.data,
        `User should not expose password. Response: ${JSON.stringify(res.body)}`,
      ).not.toHaveProperty("password"); // Password should not be returned
    });

    it("GET /api/v1/users/profile should reject without authentication", async () => {
      const res = await request(app).get("/api/v1/users/profile").expect(401);

      expect(
        res.body,
        `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
      expect(
        res.body,
        `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("error");
    });
  });

  describe("Update User Profile", () => {
    it("PUT /api/v1/users/profile should update user profile", async () => {
      const updateData = {
        displayedName: "Updated User",
      };

      const res = await request(app)
        .put("/api/v1/users/profile")
        .set("token", authToken)
        .send(updateData)
        .expect(200);

      expect(
        res.body,
        `Profile update should have success property. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", true);
      expect(
        res.body.data,
        `Profile update should have user data. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("id");
      expect(
        res.body.data,
        `User should have updated displayedName. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("displayedName", updateData.displayedName);
    });

    it("PUT /api/v1/users/profile should reject without authentication", async () => {
      const updateData = {
        displayedName: "Updated Profile Test User",
      };

      const res = await request(app)
        .put("/api/v1/users/profile")
        .send(updateData)
        .expect(401);

      expect(
        res.body,
        `Unauthenticated update should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
      expect(
        res.body,
        `Unauthenticated update should have error message. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("error");
    });

    it("PUT /api/v1/users/profile should reject invalid data", async () => {
      const updateData = {
        displayedName: "", // Empty displayed name
        email: "invalid-email", // Invalid email format
      };

      const res = await request(app)
        .put("/api/v1/users/profile")
        .set("token", authToken)
        .send(updateData)
        .expect(400);

      expect(
        res.body,
        `Invalid data should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
      expect(
        res.body,
        `Invalid data should have error message. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("error");
    });
  });

  describe("Update User by ID", () => {
    it("PUT /api/v1/users/:userId should update user by ID", async () => {
      console.log(
        "Debug - userId from registration:",
        userId,
        "type:",
        typeof userId,
      );

      const updateData = {
        displayedName: "Updated User",
        email: `updatedbyid_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}@test.com`,
      };

      const res = await request(app)
        .put(`/api/v1/users/${userId}`)
        .set("token", authToken)
        .send(updateData);

      console.log("Update by ID response status:", res.status);
      console.log(
        "Update by ID response body:",
        JSON.stringify(res.body, null, 2),
      );

      expect(
        res.status,
        `Update by ID should return 200 status. Response: ${JSON.stringify(res.body)}`,
      ).toBe(200);
      expect(
        res.body,
        `Update by ID should have success property. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", true);
      expect(
        res.body.data,
        `Update by ID should have user data. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("id");
      expect(
        res.body.data,
        `User should have correct id. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("id", userId);
      expect(
        res.body.data,
        `User should have updated displayedName. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("displayedName", updateData.displayedName);
      expect(
        res.body.data,
        `User should have updated email. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("email", updateData.email);
    });

    it("PUT /api/v1/users/:userId should reject updating other user", async () => {
      const updateData = {
        displayedName: "Other User",
      };

      const res = await request(app)
        .put("/api/v1/users/999") // Different user ID
        .set("token", authToken)
        .send(updateData)
        .expect(403);

      expect(
        res.body,
        `Updating other user should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
      expect(
        res.body,
        `Updating other user should have error message. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("error");
    });

    it("PUT /api/v1/users/:userId should reject without authentication", async () => {
      const updateData = {
        displayedName: "No Auth User",
      };

      const res = await request(app)
        .put(`/api/v1/users/${userId}`)
        .send(updateData)
        .expect(401);

      expect(
        res.body,
        `Unauthenticated update by ID should have success false. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("success", false);
      expect(
        res.body,
        `Unauthenticated update by ID should have error message. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("error");
    });
  });
});
