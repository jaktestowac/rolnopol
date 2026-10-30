import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function registerUser(label) {
  const res = await request(app)
    .post("/api/v1/register")
    .send({
      email: `moneysec_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@test.com`,
      displayedName: `MoneySec_${label}`,
      password: "testpass123",
    });
  expect(res.status, `register ${label}: ${JSON.stringify(res.body)}`).toBe(201);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

async function deposit(user, amount) {
  const res = await request(app)
    .post("/api/v1/financial/transactions")
    .set("token", user.token)
    .send({ type: "income", amount, description: "Test deposit", cardNumber: "4242424242424242", cvv: "123" })
    .expect(201);
  return res.body.data.transaction;
}

async function balanceOf(user) {
  const res = await request(app).get("/api/v1/financial/account").set("token", user.token).expect(200);
  return res.body.data.account.balance;
}

describe("Money API security", () => {
  let originalFlags;

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = res.body.data.flags;
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({
        flags: {
          financialCommoditiesEnabled: true,
          financialCommoditiesTradingEnabled: true,
          personalApiKeysEnabled: true,
          financialCsvExportEnabled: true,
        },
      })
      .expect(200);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  describe("authentication", () => {
    it.each([
      ["get", "/api/v1/financial/account"],
      ["post", "/api/v1/financial/transactions"],
      ["get", "/api/v1/financial/transactions"],
      ["get", "/api/v1/financial/transactions/1"],
      ["get", "/api/v1/financial/stats"],
      ["post", "/api/v1/financial/transfer"],
      ["get", "/api/v1/financial/accounts/all"],
      ["put", "/api/v1/financial/accounts/balance"],
      ["get", "/api/v1/marketplace/offers"],
      ["get", "/api/v1/marketplace/my-offers"],
      ["post", "/api/v1/marketplace/offers"],
      ["post", "/api/v1/marketplace/buy"],
      ["delete", "/api/v1/marketplace/offers/1"],
      ["get", "/api/v1/marketplace/transactions"],
      ["get", "/api/v1/commodities/portfolio"],
      ["post", "/api/v1/commodities/buy"],
      ["post", "/api/v1/commodities/sell"],
    ])("%s %s requires a token", async (method, path) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("authorization", () => {
    it("a regular user cannot list all accounts or set a balance", async () => {
      const user = await registerUser("noadmin");
      const before = await balanceOf(user);

      await request(app).get("/api/v1/financial/accounts/all").set("token", user.token).expect(403);
      await request(app)
        .put("/api/v1/financial/accounts/balance")
        .set("token", user.token)
        .send({ userId: user.id, amount: 1000000, description: "Free money" })
        .expect(403);

      expect(await balanceOf(user)).toBe(before);
    });

    it("a user can read their own transaction by id but not someone else's", async () => {
      const owner = await registerUser("owner");
      const other = await registerUser("other");
      const tx = await deposit(owner, 25);

      const own = await request(app).get(`/api/v1/financial/transactions/${tx.id}`).set("token", owner.token).expect(200);
      expect(own.body.data).toMatchObject({ id: tx.id, amount: 25 });

      await request(app).get(`/api/v1/financial/transactions/${tx.id}`).set("token", other.token).expect(404);
    });

    it("marketplace transaction history only shows the caller's own purchases", async () => {
      const seller = await registerUser("histseller");
      const buyer = await registerUser("histbuyer");
      const outsider = await registerUser("outsider");
      await deposit(buyer, 100);
      const field = await request(app).post("/api/v1/fields").set("token", seller.token).send({ name: "History Field", area: 3 });
      const offer = await request(app)
        .post("/api/v1/marketplace/offers")
        .set("token", seller.token)
        .send({ itemType: "field", itemId: field.body.data.id, price: 30 });
      const bought = await request(app)
        .post("/api/v1/marketplace/buy")
        .set("token", buyer.token)
        .send({ offerId: offer.body.data.offer.id })
        .expect(200);
      const purchaseId = bought.body.data.transaction.id;

      const historyOf = async (user) => {
        const res = await request(app).get("/api/v1/marketplace/transactions").set("token", user.token).expect(200);
        return JSON.stringify(res.body.data);
      };

      expect(await historyOf(buyer)).toContain(`"id":${purchaseId},`);
      expect(await historyOf(seller)).toContain(`"id":${purchaseId},`);
      expect(await historyOf(outsider)).not.toContain(`"id":${purchaseId},`);
    });
  });

  describe("personal API keys", () => {
    async function createKey(user, scopes, mode) {
      const res = await request(app)
        .post("/api/v1/users/profile/api-keys")
        .set("token", user.token)
        .send({ label: "Money key", scopes, mode })
        .expect(201);
      return res.body.data.rawKey;
    }

    it("a key scoped to fields cannot read or move money", async () => {
      const owner = await registerUser("keyfields");
      const recipient = await registerUser("keyrcpt");
      await deposit(owner, 50);
      const key = await createKey(owner, ["fields"], "write");

      await request(app).get("/api/v1/financial/account").set("X-API-Key", key).expect(403);
      await request(app)
        .post("/api/v1/financial/transfer")
        .set("X-API-Key", key)
        .send({ toUserId: recipient.id, amount: 10, description: "Key transfer" })
        .expect(403);
      await request(app).post("/api/v1/marketplace/buy").set("X-API-Key", key).send({ offerId: 1 }).expect(403);

      expect(await balanceOf(owner)).toBe(50);
    });

    it("a read-only key can see the balance but cannot transfer", async () => {
      const owner = await registerUser("keyread");
      const recipient = await registerUser("keyrdrcpt");
      await deposit(owner, 50);
      const key = await createKey(owner, ["all"], "read");

      const account = await request(app).get("/api/v1/financial/account").set("X-API-Key", key).expect(200);
      expect(account.body.data.account.balance).toBe(50);
      await request(app)
        .post("/api/v1/financial/transfer")
        .set("X-API-Key", key)
        .send({ toUserId: recipient.id, amount: 10, description: "Key transfer" })
        .expect(403);

      expect(await balanceOf(owner)).toBe(50);
    });

    it("a revoked key stops working", async () => {
      const owner = await registerUser("keyrevoke");
      const created = await request(app)
        .post("/api/v1/users/profile/api-keys")
        .set("token", owner.token)
        .send({ label: "Revoke me", scopes: ["all"], mode: "read" })
        .expect(201);

      await request(app).delete(`/api/v1/users/profile/api-keys/${created.body.data.key.id}`).set("token", owner.token).expect(200);

      await request(app).get("/api/v1/financial/account").set("X-API-Key", created.body.data.rawKey).expect(403);
    });
  });

  describe("stored content injection", () => {
    it.each([
      ['<img src=x onerror="alert(1)">'],
      ["=HYPERLINK(evil)"],
      ["-SUM(1,2)"],
      ["x".repeat(31)],
      [{ nested: "object" }],
    ])("rejects transaction category %j", async (category) => {
      const user = await registerUser("category");

      const res = await request(app)
        .post("/api/v1/financial/transactions")
        .set("token", user.token)
        .send({ type: "income", amount: 5, description: "Category test", category, cardNumber: "4242424242424242", cvv: "123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid category");
      expect(await balanceOf(user)).toBe(0);
    });

    it("accepts the categories the UI offers", async () => {
      const user = await registerUser("categoryok");
      for (const category of ["general", "equipment", "livestock", "crops", "maintenance"]) {
        await request(app)
          .post("/api/v1/financial/transactions")
          .set("token", user.token)
          .send({ type: "income", amount: 1, description: "Category ok", category, cardNumber: "4242424242424242", cvv: "123" })
          .expect(201);
      }
      expect(await balanceOf(user)).toBe(5);
    });

    it("CSV export neutralises descriptions that a spreadsheet would run as formulas", async () => {
      const user = await registerUser("csv");
      await request(app)
        .post("/api/v1/financial/transactions")
        .set("token", user.token)
        .send({ type: "income", amount: 7, description: "-SUM(1,2)", cardNumber: "4242424242424242", cvv: "123" })
        .expect(201);

      const res = await request(app).get("/api/v1/financial/export/csv").set("token", user.token).expect(200);

      expect(res.text).toContain(`"'-SUM(1,2)"`);
      expect(res.text).not.toMatch(/(^|,)"?-SUM/m);
    });
  });

  describe("transfer input validation", () => {
    it.each([
      ["negative", -10],
      ["zero", 0],
      ["exponent notation", "1e2"],
      ["three decimals", "10.001"],
      ["over the cap", 1000],
      ["not a number", "abc"],
      ["more than the balance", 60],
    ])("rejects a %s amount without moving money", async (_label, amount) => {
      const sender = await registerUser("sender");
      const recipient = await registerUser("recipient");
      await deposit(sender, 50);
      const senderBefore = await balanceOf(sender);
      const recipientBefore = await balanceOf(recipient);

      const res = await request(app)
        .post("/api/v1/financial/transfer")
        .set("token", sender.token)
        .send({ toUserId: recipient.id, amount, description: "Invalid transfer" });

      expect(res.status).toBe(400);
      expect(await balanceOf(sender)).toBe(senderBefore);
      expect(await balanceOf(recipient)).toBe(recipientBefore);
    });

    it("rejects an expense larger than the balance", async () => {
      const user = await registerUser("overdraft");
      await deposit(user, 20);

      const res = await request(app)
        .post("/api/v1/financial/transactions")
        .set("token", user.token)
        .send({ type: "expense", amount: 20.01, description: "Too much" });

      expect(res.status).toBe(400);
      expect(await balanceOf(user)).toBe(20);
    });
  });

  describe("commodities", () => {
    it("rejects a trade worth less than one cent", async () => {
      const user = await registerUser("dust");
      await deposit(user, 10);
      const prices = await request(app).get("/api/v1/commodities/prices?symbols=silver").set("token", user.token).expect(200);
      expect(prices.body.data.prices[0].buyPrice * 0.0001).toBeLessThan(0.005);

      const res = await request(app).post("/api/v1/commodities/buy").set("token", user.token).send({ symbol: "silver", quantity: "0.0001" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 0.01 ROL");
      expect(await balanceOf(user)).toBe(10);
    });

    it("rejects a buy the user cannot afford", async () => {
      const user = await registerUser("poor");

      const res = await request(app).post("/api/v1/commodities/buy").set("token", user.token).send({ symbol: "gold", quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Insufficient funds");
    });

    it("rejects selling more than the user holds", async () => {
      const user = await registerUser("short");

      const res = await request(app).post("/api/v1/commodities/sell").set("token", user.token).send({ symbol: "gold", quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Insufficient quantity");
      expect(await balanceOf(user)).toBe(0);
    });

    it("a buy then a full sell leaves no holding and pays the proceeds", async () => {
      const user = await registerUser("roundtrip");
      await deposit(user, 999);
      await deposit(user, 999);

      const buy = await request(app).post("/api/v1/commodities/buy").set("token", user.token).send({ symbol: "silver", quantity: 2 }).expect(201);
      const afterBuy = await balanceOf(user);
      expect(afterBuy).toBe(Math.round((1998 - buy.body.data.totalCost) * 100) / 100);

      const sell = await request(app).post("/api/v1/commodities/sell").set("token", user.token).send({ symbol: "silver", quantity: 2 }).expect(201);
      expect(await balanceOf(user)).toBe(Math.round((afterBuy + sell.body.data.totalProceeds) * 100) / 100);

      const portfolio = await request(app).get("/api/v1/commodities/portfolio").set("token", user.token).expect(200);
      expect(JSON.stringify(portfolio.body.data)).not.toContain('"symbol":"SILVER"');
    });
  });
});
