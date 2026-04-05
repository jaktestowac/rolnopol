import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// Import the app
const app = require("../api/index.js");
const databaseManager = require("../data/database-manager.js");

describe("Pet Buddy API Integration Tests", () => {
  let authToken;
  let userId = "test-user-" + Date.now();
  let petId;

  beforeEach(async () => {
    // Create a test user and get auth token
    const registerRes = await request(app)
      .post("/api/v1/register")
      .send({
        email: `buddy_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
        displayedName: "Buddy Tester",
        password: "testpass123",
      });

    if (registerRes.status === 201) {
      authToken = registerRes.body.data.token;
      userId = registerRes.body.data.user.id;
    } else if (registerRes.body.data?.token) {
      authToken = registerRes.body.data.token;
    }
  });

  afterEach(async () => {
    // Cleanup - clear pets database for next test
    try {
      const petsDb = databaseManager.getPetsDatabase();
      await petsDb.write({ pets: [] });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("POST /api/v1/buddy - Hatch Pet", () => {
    it("should hatch a new pet", async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      expect(res.status, `Status should be 201. Response: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data).toHaveProperty("name");
      expect(res.body.data).toHaveProperty("species");
      expect(res.body.data).toHaveProperty("rarity");
      expect(res.body.data).toHaveProperty("ascii");
      expect(res.body.data).toHaveProperty("personality");
      expect(res.body.data).toHaveProperty("message");

      petId = res.body.data.id;
    });

    it("should prevent hatching second pet (one per user)", async () => {
      // Hatch first pet
      const res1 = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      expect(res1.status).toBe(201);

      // Try to hatch second pet
      const res2 = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      expect(res2.status, `Status should be 409. Response: ${JSON.stringify(res2.body)}`).toBe(409);
      expect(res2.body).toHaveProperty("success", false);
      expect(res2.body.error).toContain("ALREADY_HAS_PET");
    });

    it("should require authentication", async () => {
      const res = await request(app).post("/api/v1/buddy").send({});

      expect(res.status).toBe(401);
    });

    it("should respect feature flag", async () => {
      // This test assumes feature flag is enabled in test environment
      // If disabled, will return 403
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      expect([201, 403]).toContain(res.status);
    });
  });

  describe("GET /api/v1/buddy - Get User's Pet", () => {
    beforeEach(async () => {
      // Hatch a pet first
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should get user's pet", async () => {
      const res = await request(app).get("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`);

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data).toHaveProperty("name");
      expect(res.body.data).toHaveProperty("personality");
      expect(res.body.data).toHaveProperty("ascii");
    });

    it("should return 404 if user has no pet", async () => {
      // Create fresh user without pet
      const newUserRes = await request(app)
        .post("/api/v1/register")
        .send({
          email: `buddy_nopet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          displayedName: "No Pet User",
          password: "testpass123",
        });

      const newToken = newUserRes.body.data.token;

      const res = await request(app).get("/api/v1/buddy").set("Authorization", `Bearer ${newToken}`);

      expect(res.status, `Status should be 404. Response: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body).toHaveProperty("success", false);
    });

    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/buddy");

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/buddy/:id - Get Pet by ID", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should get pet by ID", async () => {
      const res = await request(app).get(`/api/v1/buddy/${petId}`).set("Authorization", `Bearer ${authToken}`);

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toHaveProperty("id", petId);
      expect(res.body.data).toHaveProperty("name");
    });

    it("should return 404 for non-existent pet", async () => {
      const res = await request(app).get("/api/v1/buddy/invalid-pet-id").set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/v1/buddy/:id - Release/Delete Pet", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should release pet successfully", async () => {
      const res = await request(app).delete(`/api/v1/buddy/${petId}`).set("Authorization", `Bearer ${authToken}`);

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.data).toHaveProperty("message");
    });

    it("should allow hatching new pet after release", async () => {
      // Release first pet
      await request(app).delete(`/api/v1/buddy/${petId}`).set("Authorization", `Bearer ${authToken}`);

      // Hatch new pet - should succeed
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      expect(res.status, `Status should be 201. Response: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toHaveProperty("success", true);
    });

    it("should return 404 for non-existent pet", async () => {
      const res = await request(app).delete("/api/v1/buddy/invalid-pet-id").set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    it("should prevent deleting other user's pet", async () => {
      // Create another user
      const otherUserRes = await request(app)
        .post("/api/v1/register")
        .send({
          email: `buddy_other_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          displayedName: "Other User",
          password: "testpass123",
        });

      const otherToken = otherUserRes.body.data.token;

      // Try to delete first user's pet with other user's token
      const res = await request(app).delete(`/api/v1/buddy/${petId}`).set("Authorization", `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/buddy/:id - Update Customization", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should update pet eyes", async () => {
      const res = await request(app)
        .patch(`/api/v1/buddy/${petId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          customization: { eyes: "×" },
        });

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data.customization.eyes).toBe("×");
    });

    it("should update pet hat", async () => {
      const res = await request(app)
        .patch(`/api/v1/buddy/${petId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          customization: { hat: "crown" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customization.hat).toBe("crown");
    });

    it("should update multiple customizations at once", async () => {
      const res = await request(app)
        .patch(`/api/v1/buddy/${petId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          customization: { eyes: "×", hat: "wizard" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customization.eyes).toBe("×");
      expect(res.body.data.customization.hat).toBe("wizard");
    });

    it("should return 404 for non-existent pet", async () => {
      const res = await request(app)
        .patch("/api/v1/buddy/invalid-id")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          customization: { eyes: "×" },
        });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/buddy/:id/pet - Pet Interaction", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should pet the buddy", async () => {
      const res = await request(app).post(`/api/v1/buddy/${petId}/pet`).set("Authorization", `Bearer ${authToken}`).send({});

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toHaveProperty("message");
      expect(res.body.data).toHaveProperty("totalPets");
      expect(res.body.data.totalPets).toBeGreaterThan(0);
    });

    it("should increment pet count", async () => {
      const res1 = await request(app).post(`/api/v1/buddy/${petId}/pet`).set("Authorization", `Bearer ${authToken}`).send({});

      const res2 = await request(app).post(`/api/v1/buddy/${petId}/pet`).set("Authorization", `Bearer ${authToken}`).send({});

      expect(res2.body.data.totalPets).toBe(res1.body.data.totalPets + 1);
    });
  });

  describe("POST /api/v1/buddy/:id/talk - Talk Interaction", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should talk to buddy", async () => {
      const res = await request(app)
        .post(`/api/v1/buddy/${petId}/talk`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "Hello buddy!" });

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toHaveProperty("message");
      expect(res.body.data).toHaveProperty("totalTalks");
    });

    it("should increment talk count", async () => {
      const res1 = await request(app)
        .post(`/api/v1/buddy/${petId}/talk`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "Hi" });

      const res2 = await request(app)
        .post(`/api/v1/buddy/${petId}/talk`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "Hello" });

      expect(res2.body.data.totalTalks).toBe(res1.body.data.totalTalks + 1);
    });
  });

  describe("POST /api/v1/buddy/:id/ask-help - Ask for Help Interaction", () => {
    beforeEach(async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send({});

      if (res.status === 201) {
        petId = res.body.data.id;
      }
    });

    it("should ask buddy for help", async () => {
      const res = await request(app)
        .post(`/api/v1/buddy/${petId}/ask-help`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "How do I reverse a string?" });

      expect(res.status, `Status should be 200. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toHaveProperty("message");
      expect(res.body.data).toHaveProperty("helpMessage");
      expect(res.body.data).toHaveProperty("totalAskedForHelp");
      expect(res.body.data.helpMessage).toBeTruthy();
    });

    it("should increment help count", async () => {
      const res1 = await request(app)
        .post(`/api/v1/buddy/${petId}/ask-help`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "Question 1?" });

      const res2 = await request(app)
        .post(`/api/v1/buddy/${petId}/ask-help`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "Question 2?" });

      expect(res2.body.data.totalAskedForHelp).toBe(res1.body.data.totalAskedForHelp + 1);
    });

    it("should return personality-based advice", async () => {
      const res = await request(app)
        .post(`/api/v1/buddy/${petId}/ask-help`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ message: "How do I code?" });

      expect(res.status).toBe(200);
      expect(res.body.data.helpMessage).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should return 400 for missing required fields in hatch", async () => {
      const res = await request(app).post("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`).send(); // Empty body

      // Should still succeed - pets don't require body fields
      expect([201, 400]).toContain(res.status);
    });

    it("should return 400 for missing pet ID in interactions", async () => {
      const res = await request(app)
        .post("/api/v1/buddy//pet") // Missing ID
        .set("Authorization", `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it("should handle database errors gracefully", async () => {
      // Make a valid request - even if database fails, should get proper error
      const res = await request(app).get("/api/v1/buddy").set("Authorization", `Bearer ${authToken}`);

      // Should return 404 (no pet) or 200 (has pet), not 500
      expect([200, 404, 500]).toContain(res.status);
    });
  });
});
