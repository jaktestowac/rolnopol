import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("Financial API", () => {
  let authToken;
  let userId;
  let testUser;

  beforeEach(async () => {
    // Create a fresh test user for each test to avoid conflicts
    testUser = {
      email: `financialtestuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
      displayedName: "Financial Test User",
      password: "testpass123",
    };

    // Create a test user and get authentication token
    try {
      const registerRes = await request(app).post("/api/v1/register").send(testUser);

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
      console.warn("Skipping financial tests due to authentication failure");
    }
  });

  describe("Account Management", () => {
    it("GET /api/v1/financial/account should return user account", async () => {
      const res = await request(app).get("/api/v1/financial/account").set("token", authToken).expect(200);

      expect(res.body, `Account response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Account response should have account data. Response: ${JSON.stringify(res.body)}`).toHaveProperty("account");
      expect(res.body.data.account, `Account should have correct userId. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "userId",
        userId
      );
      expect(res.body.data.account, `Account should have balance property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "balance"
      );
      expect(res.body.data.account, `Account should have ROL currency. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "currency",
        "ROL"
      );
    });

    it("GET /api/v1/financial/account should reject without authentication", async () => {
      const res = await request(app).get("/api/v1/financial/account").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Transactions", () => {
    it("POST /api/v1/financial/transactions should add income transaction", async () => {
      const transactionData = {
        type: "income",
        amount: 100,
        description: "Test income transaction",
        category: "test",
        cardNumber: "4242424242424242",
        cvv: "123",
      };

      const res = await request(app).post("/api/v1/financial/transactions").set("token", authToken).send(transactionData).expect(201);

      expect(res.body, `Transaction response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Transaction response should have transaction data. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "transaction"
      );
      expect(res.body.data.transaction, `Transaction should have correct type. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "type",
        "income"
      );
      expect(res.body.data.transaction, `Transaction should have correct amount. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "amount",
        100
      );
      expect(
        res.body.data.transaction,
        `Transaction should have correct description. Response: ${JSON.stringify(res.body)}`
      ).toHaveProperty("description", "Test income transaction");
    });

    it("POST /api/v1/financial/transactions should add expense transaction", async () => {
      // Add income first to ensure positive balance
      await request(app)
        .post("/api/v1/financial/transactions")
        .set("token", authToken)
        .send({
          type: "income",
          amount: 100,
          description: "Initial deposit",
          cardNumber: "4242424242424242",
          cvv: "123",
        })
        .expect(201);

      const transactionData = {
        type: "expense",
        amount: 50,
        description: "Test expense transaction",
        category: "test",
      };

      const res = await request(app).post("/api/v1/financial/transactions").set("token", authToken).send(transactionData);

      expect(res.status, `POST /api/v1/financial/transactions should return 201 status. Response: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body, `Transaction response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Transaction response should have transaction data. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "transaction"
      );
      expect(res.body.data.transaction, `Transaction should have correct type. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "type",
        "expense"
      );
      expect(res.body.data.transaction, `Transaction should have correct amount. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "amount",
        50
      );
    });

    it("POST /api/v1/financial/transactions should reject invalid transaction type", async () => {
      const transactionData = {
        type: "invalid",
        amount: 100,
        description: "Test transaction",
      };

      const res = await request(app).post("/api/v1/financial/transactions").set("token", authToken).send(transactionData).expect(400);

      expect(res.body, `Invalid transaction should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Invalid transaction should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("POST /api/v1/financial/transactions should reject negative amount", async () => {
      const transactionData = {
        type: "income",
        amount: -100,
        description: "Test transaction",
        cardNumber: "4242424242424242",
        cvv: "123",
      };

      const res = await request(app).post("/api/v1/financial/transactions").set("token", authToken).send(transactionData).expect(400);

      expect(res.body, `Negative amount should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Negative amount should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("GET /api/v1/financial/transactions should return transaction history", async () => {
      // First add a transaction
      await request(app).post("/api/v1/financial/transactions").set("token", authToken).send({
        type: "income",
        amount: 200,
        description: "Test transaction for history",
        category: "test",
        cardNumber: "4242424242424242",
        cvv: "123",
      });

      // Then get transaction history
      const res = await request(app).get("/api/v1/financial/transactions").set("token", authToken).expect(200);

      expect(res.body, `Transaction history should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Transaction history should have transactions array. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "transactions"
      );
      expect(Array.isArray(res.body.data.transactions), `Transactions should be an array. Response: ${JSON.stringify(res.body)}`).toBe(
        true
      );
      expect(
        res.body.data.transactions.length,
        `Transaction history should contain at least one transaction. Response: ${JSON.stringify(res.body)}`
      ).toBeGreaterThan(0);
    });
  });

  describe("Financial Statistics", () => {
    it("GET /api/v1/financial/stats should return financial statistics", async () => {
      const res = await request(app).get("/api/v1/financial/stats").set("token", authToken).expect(200);

      expect(res.body, `Financial stats should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Financial stats should have statistics data. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "statistics"
      );
      expect(res.body.data.statistics, `Statistics should have totalIncome property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "totalIncome"
      );
      expect(
        res.body.data.statistics,
        `Statistics should have totalExpenses property. Response: ${JSON.stringify(res.body)}`
      ).toHaveProperty("totalExpenses");
      expect(
        res.body.data.statistics,
        `Statistics should have currentBalance property. Response: ${JSON.stringify(res.body)}`
      ).toHaveProperty("currentBalance");
    });
  });
});
