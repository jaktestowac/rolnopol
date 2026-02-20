import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("Authentication API", () => {
  let testUser;

  async function getCurrentFlags() {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    return res.body?.data?.flags || {};
  }

  async function patchFlags(partialFlags) {
    await request(app).patch("/api/v1/feature-flags").send({ flags: partialFlags }).expect(200);
  }

  async function replaceFlags(flags) {
    await request(app).put("/api/v1/feature-flags").send({ flags }).expect(200);
  }

  beforeEach(() => {
    // Create a fresh test user for each test to avoid conflicts
    testUser = {
      email: `testuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
      displayedName: "Test User",
      password: "testpass123",
    };
  });

  describe("User Registration", () => {
    it("POST /api/v1/register should register a new user successfully", async () => {
      const res = await request(app).post("/api/v1/register").send(testUser).expect(201);

      expect(res.body, `Registration response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true,
      );
      expect(res.body.data, `Registration response should have data property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "user",
      );
      expect(res.body.data.user, `User object should have id property. Response: ${JSON.stringify(res.body)}`).toHaveProperty("id");
      expect(res.body.data.user, `User object should have correct email. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "email",
        testUser.email,
      );
      expect(res.body.data.user, `User object should have correct displayedName. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "displayedName",
        testUser.displayedName,
      );
      expect(res.body.data.user, `User object should not expose password. Response: ${JSON.stringify(res.body)}`).not.toHaveProperty(
        "password",
      ); // Password should not be returned
      expect(
        res.body.data,
        `Registration response should include authentication token. Response: ${JSON.stringify(res.body)}`,
      ).toHaveProperty("token");
    });

    it("POST /api/v1/register should reject duplicate email", async () => {
      // First registration
      await request(app).post("/api/v1/register").send(testUser).expect(201);

      // Second registration with same email
      const res = await request(app).post("/api/v1/register").send(testUser).expect(409);

      expect(res.body, `Duplicate registration should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false,
      );
      expect(res.body, `Duplicate registration should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(res.body.error, `Error message should mention user already exists. Response: ${JSON.stringify(res.body)}`).toContain(
        "already exists",
      );
    });

    it("POST /api/v1/register should reject invalid email", async () => {
      const invalidUser = {
        email: "bad-email", // invalid email
        displayedName: "Admin User",
        password: "testpass123",
      };

      const res = await request(app).post("/api/v1/register").send(invalidUser).expect(400);

      expect(res.body, `Invalid email should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Invalid email should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(res.body.error, `Error message should mention email. Response: ${JSON.stringify(res.body)}`).toContain("Email");
    });

    it("POST /api/v1/register should reject invalid data", async () => {
      const invalidUser = {
        email: "", // Empty email
        displayedName: "",
        password: "",
      };

      const res = await request(app).post("/api/v1/register").send(invalidUser).expect(400);

      expect(res.body, `Invalid data should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Invalid data should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("POST /api/v1/register should enforce strong password when registrationStrongPasswordEnabled is true", async () => {
      const originalFlags = await getCurrentFlags();

      try {
        await patchFlags({ registrationStrongPasswordEnabled: true });

        const weakPasswordUser = {
          email: `weak_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
          displayedName: "Weak Password User",
          password: "weak123",
        };

        const res = await request(app).post("/api/v1/register").send(weakPasswordUser).expect(400);

        expect(res.body).toHaveProperty("success", false);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toContain("uppercase");
      } finally {
        await replaceFlags(originalFlags);
      }
    });

    it("POST /api/v1/register should allow strong password when registrationStrongPasswordEnabled is true", async () => {
      const originalFlags = await getCurrentFlags();

      try {
        await patchFlags({ registrationStrongPasswordEnabled: true });

        const strongPasswordUser = {
          email: `strong_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
          displayedName: "Strong Password User",
          password: "StrongPass1!",
        };

        const res = await request(app).post("/api/v1/register").send(strongPasswordUser).expect(201);

        expect(res.body).toHaveProperty("success", true);
        expect(res.body.data.user).toHaveProperty("email", strongPasswordUser.email);
      } finally {
        await replaceFlags(originalFlags);
      }
    });
  });

  describe("User Login", () => {
    beforeEach(async () => {
      // Ensure test user exists by trying to register
      try {
        await request(app).post("/api/v1/register").send(testUser);
      } catch (error) {
        // User might already exist, that's okay
      }
    });

    it("POST /api/v1/login should authenticate valid user", async () => {
      const res = await request(app).post("/api/v1/login").send({
        email: testUser.email,
        password: testUser.password,
      });

      if (res.status !== 200) {
        console.error("Login failed with status:", res.status);
        console.error("Response body:", res.body);
      }

      expect(res.status, `Valid login should return 200 status. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, `Login response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true,
      );
      expect(res.body.data, `Login response should have user data. Response: ${JSON.stringify(res.body)}`).toHaveProperty("user");
      expect(res.body.data.user, `User object should have correct email. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "email",
        testUser.email,
      );
      expect(res.body.data, `Login response should include authentication token. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "token",
      );
    });

    it("POST /api/v1/login should reject invalid credentials", async () => {
      const res = await request(app).post("/api/v1/login").send({
        email: testUser.email,
        password: "wrongpassword",
      });

      expect(res.status, `Invalid credentials should return 401 status. Response: ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body, `Invalid credentials should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false,
      );
      expect(res.body, `Invalid credentials should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
      expect(res.body.error, `Error message should mention invalid credentials. Response: ${JSON.stringify(res.body)}`).toContain(
        "Invalid credentials",
      );
    });

    it("POST /api/v1/login should reject non-existent user", async () => {
      const res = await request(app)
        .post("/api/v1/login")
        .send({
          email: `nonexistent_${Date.now()}@test.com`,
          password: "testpass123",
        });

      expect(res.status, `Non-existent user should return 401 status. Response: ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body, `Non-existent user should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false,
      );
      expect(res.body, `Non-existent user should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });
});
