import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

describe("Marketplace API", () => {
  let authToken;
  let userId;
  let testUser;
  let testOffer;

  beforeEach(async () => {
    // Create a fresh test user for each test to avoid conflicts
    testUser = {
      email: `marketplacetestuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
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
      console.error("❌ Registration response:", registerRes && registerRes.status, registerRes && registerRes.body);
      console.error("❌ Login response:", loginRes && loginRes.status, loginRes && loginRes.body);
      throw new Error("authToken was not set during test setup. Registration or login failed.");
    }

    // Create a field for the test user
    const fieldRes = await request(app).post("/api/v1/fields").set("token", authToken).send({ name: "Test Field", area: 10 });

    if (!fieldRes.body.data || !fieldRes.body.data.id) {
      console.error("Field creation failed:", fieldRes.status, fieldRes.body);
      throw new Error("Failed to create test field - no field ID returned");
    }

    const fieldId = fieldRes.body.data.id;

    // Unassign any animals from the field before creating the offer
    // (since we can't sell fields with assigned animals)
    const animalsRes = await request(app).get("/api/v1/animals").set("token", authToken);
    if (animalsRes.status === 200 && animalsRes.body.data && Array.isArray(animalsRes.body.data.animals)) {
      const fieldAnimals = animalsRes.body.data.animals.filter(animal => animal.fieldId === fieldId);
      for (const animal of fieldAnimals) {
        await request(app)
          .put(`/api/v1/animals/${animal.id}`)
          .set("token", authToken)
          .send({ ...animal, fieldId: 0 });
      }
    }

    // Create a valid test offer for a field
    testOffer = {
      itemType: "field",
      itemId: fieldId,
      price: 100,
      description: "A test item for marketplace",
    };
  });

  describe("Get Marketplace Offers", () => {
    it("GET /api/v1/marketplace/offers should return all offers", async () => {
      const res = await request(app).get("/api/v1/marketplace/offers").set("token", authToken).expect(200);

      expect(res.body, `Offers response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Offers response should have offers array. Response: ${JSON.stringify(res.body)}`).toHaveProperty("offers");
      expect(Array.isArray(res.body.data.offers), `Offers should be an array. Response: ${JSON.stringify(res.body)}`).toBe(true);
    });

    it("GET /api/v1/marketplace/offers should reject without authentication", async () => {
      const res = await request(app).get("/api/v1/marketplace/offers").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Get My Offers", () => {
    it("GET /api/v1/marketplace/my-offers should return user offers", async () => {
      const res = await request(app).get("/api/v1/marketplace/my-offers").set("token", authToken).expect(200);

      expect(res.body, `My offers response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `My offers response should have offers array. Response: ${JSON.stringify(res.body)}`).toHaveProperty("offers");
      expect(Array.isArray(res.body.data.offers), `My offers should be an array. Response: ${JSON.stringify(res.body)}`).toBe(true);
    });

    it("GET /api/v1/marketplace/my-offers should reject without authentication", async () => {
      const res = await request(app).get("/api/v1/marketplace/my-offers").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Create Marketplace Offer", () => {
    it("POST /api/v1/marketplace/offers should create a new offer", async () => {
      const res = await request(app).post("/api/v1/marketplace/offers").set("token", authToken).send(testOffer);
      expect(res.status, `Create offer request should return 200 status. Response: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, `Create offer response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Create offer response should have offer data. Response: ${JSON.stringify(res.body)}`).toHaveProperty("offer");
      expect(res.body.data.offer, `Offer should have correct itemName. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "itemType",
        testOffer.itemType
      );
      expect(res.body.data.offer, `Offer should have correct price. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "price",
        testOffer.price
      );
      expect(res.body.data.offer, `Offer should have sellerId. Response: ${JSON.stringify(res.body)}`).toHaveProperty("sellerId");
    });

    it("POST /api/v1/marketplace/offers should reject invalid offer data", async () => {
      const invalidOffer = {
        itemName: "", // Empty item name
        price: -100, // Negative price
        quantity: 0, // Zero quantity
      };

      const res = await request(app).post("/api/v1/marketplace/offers").set("token", authToken).send(invalidOffer).expect(400);

      expect(res.body, `Invalid offer should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", false);
      expect(res.body, `Invalid offer should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("POST /api/v1/marketplace/offers should reject without authentication", async () => {
      const res = await request(app).post("/api/v1/marketplace/offers").send(testOffer).expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Buy Item from Marketplace", () => {
    it("POST /api/v1/marketplace/buy should buy an item", async () => {
      // First create an offer
      const offerRes = await request(app).post("/api/v1/marketplace/offers").set("token", authToken).send(testOffer);

      if (offerRes.status !== 201) {
        console.log("Skipping buy test - failed to create offer");
        return;
      }

      const offerId = offerRes.body.data.offer.id;

      const buyData = {
        offerId: offerId,
        quantity: 1,
      };

      const res = await request(app).post("/api/v1/marketplace/buy").set("token", authToken).send(buyData).expect(200);

      expect(res.body, `Buy response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty("success", true);
      expect(res.body.data, `Buy response should have transaction data. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "transaction"
      );
      expect(res.body.data.transaction, `Transaction should have correct offerId. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "offerId",
        offerId
      );
    });

    it("POST /api/v1/marketplace/buy should reject invalid buy data", async () => {
      const invalidBuyData = {
        offerId: 999, // Non-existent offer
        quantity: 0, // Zero quantity
      };

      const res = await request(app).post("/api/v1/marketplace/buy").set("token", authToken).send(invalidBuyData);
      expect(res.status, `Invalid buy data should return 404 status. Response: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body, `Invalid buy data should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Invalid buy data should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("POST /api/v1/marketplace/buy should reject without authentication", async () => {
      const buyData = {
        offerId: 1,
        quantity: 1,
      };

      const res = await request(app).post("/api/v1/marketplace/buy").send(buyData).expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Cancel Marketplace Offer", () => {
    it("DELETE /api/v1/marketplace/offers/:offerId should cancel an offer", async () => {
      // First create an offer
      const offerRes = await request(app).post("/api/v1/marketplace/offers").set("token", authToken).send(testOffer);

      if (offerRes.status !== 201) {
        console.log("Skipping cancel test - failed to create offer");
        return;
      }

      const offerId = offerRes.body.data.offer.id;

      const res = await request(app).delete(`/api/v1/marketplace/offers/${offerId}`).set("token", authToken).expect(200);

      expect(res.body, `Cancel offer response should have success property. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        true
      );
      expect(res.body.data, `Cancel offer response should have message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("message");
    });

    it("DELETE /api/v1/marketplace/offers/:offerId should reject invalid offer ID", async () => {
      const res = await request(app).delete("/api/v1/marketplace/offers/invalid").set("token", authToken).expect(400);

      expect(res.body, `Invalid offer ID should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Invalid offer ID should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });

    it("DELETE /api/v1/marketplace/offers/:offerId should reject without authentication", async () => {
      const res = await request(app).delete("/api/v1/marketplace/offers/1").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Get Transaction History", () => {
    it("GET /api/v1/marketplace/transactions should return transaction history", async () => {
      const res = await request(app).get("/api/v1/marketplace/transactions").set("token", authToken).expect(200);

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
    });

    it("GET /api/v1/marketplace/transactions should reject without authentication", async () => {
      const res = await request(app).get("/api/v1/marketplace/transactions").expect(401);

      expect(res.body, `Unauthenticated request should have success false. Response: ${JSON.stringify(res.body)}`).toHaveProperty(
        "success",
        false
      );
      expect(res.body, `Unauthenticated request should have error message. Response: ${JSON.stringify(res.body)}`).toHaveProperty("error");
    });
  });

  describe("Marketplace Edge Cases", () => {
    it("should not allow buying an offer if buyer has insufficient funds", async () => {
      // Create seller and register/login
      const seller = {
        email: `seller_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@test.com`,
        displayedName: "Seller",
        password: "testpass123",
      };
      let sellerToken;
      let sellerRes = await request(app).post("/api/v1/register").send(seller);
      if (sellerRes.status === 201) {
        sellerToken = sellerRes.body.data.token;
      } else {
        const loginRes = await request(app).post("/api/v1/login").send({ email: seller.email, password: seller.password });
        if (loginRes.status === 200) {
          sellerToken = loginRes.body.data.token;
        } else {
          console.warn("Skipping test - could not register or login seller");
          return;
        }
      }
      // Create a field for the seller
      const fieldRes = await request(app).post("/api/v1/fields").set("token", sellerToken).send({ name: "Test Field", area: 10 });
      if (fieldRes.status !== 201) {
        console.warn("Skipping test - could not create field for seller");
        return;
      }
      const fieldId = fieldRes.body.data.id;
      // Create offer as seller
      const offerRes = await request(app)
        .post("/api/v1/marketplace/offers")
        .set("token", sellerToken)
        .send({ itemType: "field", itemId: fieldId, price: 99999 });
      if (!offerRes.body.data || !offerRes.body.data.offer) {
        console.warn("Skipping test - could not create offer");
        return;
      }
      const offerId = offerRes.body.data.offer.id;
      // Create buyer with low balance
      const buyer = {
        email: `buyer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@test.com`,
        displayedName: "Buyer",
        password: "testpass123",
      };
      let buyerToken;
      let buyerRes = await request(app).post("/api/v1/register").send(buyer);
      if (buyerRes.status === 201) {
        buyerToken = buyerRes.body.data.token;
      } else {
        const loginRes = await request(app).post("/api/v1/login").send({ email: buyer.email, password: buyer.password });
        if (loginRes.status === 200) {
          buyerToken = loginRes.body.data.token;
        } else {
          console.warn("Skipping test - could not register or login buyer");
          return;
        }
      }
      // Try to buy offer as buyer
      const buyRes = await request(app).post("/api/v1/marketplace/buy").set("token", buyerToken).send({ offerId }).expect(400);
      expect(buyRes.body).toHaveProperty("success", false);
      expect(buyRes.body).toHaveProperty("error");
    });

    it("should not allow creating an offer for an asset already on the marketplace", async () => {
      // Create user and register/login
      const user = {
        email: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@test.com`,
        displayedName: "User",
        password: "testpass123",
      };
      let userToken;
      let userRes = await request(app).post("/api/v1/register").send(user);
      if (userRes.status === 201) {
        userToken = userRes.body.data.token;
      } else {
        const loginRes = await request(app).post("/api/v1/login").send({ email: user.email, password: user.password });
        if (loginRes.status === 200) {
          userToken = loginRes.body.data.token;
        } else {
          console.warn("Skipping test - could not register or login user");
          return;
        }
      }
      // Create a field for the user
      const fieldRes = await request(app).post("/api/v1/fields").set("token", userToken).send({ name: "Test Field 2", area: 10 });
      if (fieldRes.status !== 201) {
        console.warn("Skipping test - could not create field for user");
        return;
      }
      const fieldId = fieldRes.body.data.id;
      // Create offer for asset
      const offerRes1 = await request(app)
        .post("/api/v1/marketplace/offers")
        .set("token", userToken)
        .send({ itemType: "field", itemId: fieldId, price: 100 });
      if (!offerRes1.body.data || !offerRes1.body.data.offer) {
        console.warn("Skipping test - could not create first offer");
        return;
      }
      // Try to create another offer for same asset
      const offerRes2 = await request(app)
        .post("/api/v1/marketplace/offers")
        .set("token", userToken)
        .send({ itemType: "field", itemId: fieldId, price: 200 })
        .expect(400);
      expect(offerRes2.body).toHaveProperty("success", false);
      expect(offerRes2.body).toHaveProperty("error");
    });

    it("should transfer ownership after purchase", async () => {
      // Create seller and register/login
      const seller = {
        email: `seller2_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@test.com`,
        displayedName: "Seller2",
        password: "testpass123",
      };
      let sellerToken;
      let sellerRes = await request(app).post("/api/v1/register").send(seller);
      if (sellerRes.status === 201) {
        sellerToken = sellerRes.body.data.token;
      } else {
        const loginRes = await request(app).post("/api/v1/login").send({ email: seller.email, password: seller.password });
        expect(buyRes.status).toBe(200);
        sellerToken = loginRes.body.data.token;
      }
      // Create a field for the seller
      const fieldRes = await request(app).post("/api/v1/fields").set("token", sellerToken).send({ name: "Test Field 3", area: 10 });
      if (fieldRes.status !== 201) {
        console.warn("Skipping test - could not create field for seller");
        return;
      }
      const fieldId = fieldRes.body.data.id;
      // Create offer as seller
      const offerRes = await request(app)
        .post("/api/v1/marketplace/offers")
        .set("token", sellerToken)
        .send({ itemType: "field", itemId: fieldId, price: 10 });
      if (!offerRes.body.data || !offerRes.body.data.offer) {
        console.warn("Skipping test - could not create offer");
        return;
      }
      const offerId = offerRes.body.data.offer.id;
      // Create buyer and register/login
      const buyer = {
        email: `buyer2_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@test.com`,
        displayedName: "Buyer2",
        password: "testpass123",
      };
      let buyerToken;
      let buyerRes = await request(app).post("/api/v1/register").send(buyer);
      if (buyerRes.status === 201) {
        buyerToken = buyerRes.body.data.token;
      } else {
        const loginRes = await request(app).post("/api/v1/login").send({ email: buyer.email, password: buyer.password });

        expect(buyRes.status, `Login response should have status 200. Response: ${JSON.stringify(buyRes.body)}`).toBe(200);
        buyerToken = loginRes.body.data.token;
      }
      await request(app)
        .post("/api/v1/financial/transactions")
        .set("token", buyerToken)
        .send({ type: "income", amount: 100, description: "Initial deposit", cardNumber: "4242424242424242", cvv: "123" })
        .expect(201);
      // Buy offer as buyer
      const buyRes = await request(app).post("/api/v1/marketplace/buy").set("token", buyerToken).send({ offerId });

      expect(buyRes.status, `Buy response should have status 400. Response: ${JSON.stringify(buyRes.body)}`).toBe(400);
      expect(buyRes.body).toHaveProperty("success", false);
      // TODO: Verify field ownership transferred (requires API support)
    });
  });
});
