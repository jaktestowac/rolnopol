import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function patchFlags(flags) {
  await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
}

async function createAndLoginUser() {
  const email = `commodities_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "testpass123";

  await request(app).post("/api/v1/register").send({ email, password, displayedName: "Commodities User" }).expect(201);

  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);

  return {
    token: loginRes.body?.data?.token,
  };
}

describe("Commodities API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when commodities feature flag is disabled", async () => {
    await patchFlags({ financialCommoditiesEnabled: false, financialCommoditiesTradingEnabled: false });

    const res = await request(app).get("/api/v1/commodities/prices").expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Commodities not found");
  });

  it("returns 401 when commodities are enabled but auth token is missing", async () => {
    await patchFlags({ financialCommoditiesEnabled: true });

    const res = await request(app).get("/api/v1/commodities/prices").expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Access token required");
  });

  it("returns current prices for requested symbols", async () => {
    await patchFlags({ financialCommoditiesEnabled: true });
    const { token } = await createAndLoginUser();

    const res = await request(app).get("/api/v1/commodities/prices?symbols=gold,silver").set("token", token).expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.prices)).toBe(true);
    expect(res.body.data.prices).toHaveLength(2);
    expect(res.body.data.prices[0]).toHaveProperty("symbol");
    expect(res.body.data.prices[0]).toHaveProperty("price");
    expect(res.body.data.prices[0]).toHaveProperty("buyPrice");
    expect(res.body.data.prices[0]).toHaveProperty("sellPrice");
    expect(res.body.data.prices[0]).toHaveProperty("hourStartUtc");
  });

  it("returns hourly history for a symbol", async () => {
    await patchFlags({ financialCommoditiesEnabled: true });
    const { token } = await createAndLoginUser();

    const res = await request(app).get("/api/v1/commodities/prices/GOLD/history?hours=12").set("token", token).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.symbol).toBe("GOLD");
    expect(res.body.data.hours).toBe(12);
    expect(Array.isArray(res.body.data.points)).toBe(true);
    expect(res.body.data.points).toHaveLength(12);
  });

  it("rejects history requests above one month", async () => {
    await patchFlags({ financialCommoditiesEnabled: true });
    const { token } = await createAndLoginUser();

    const res = await request(app).get("/api/v1/commodities/prices/GOLD/history?hours=721").set("token", token).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/between 12 and 720/i);
  });

  it("returns 404 for buy endpoint when trading flag is disabled", async () => {
    await patchFlags({ financialCommoditiesEnabled: true, financialCommoditiesTradingEnabled: false });
    const { token } = await createAndLoginUser();

    const res = await request(app).post("/api/v1/commodities/buy").set("token", token).send({ symbol: "GOLD", quantity: 0.1 }).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Commodities trading not found");
  });

  it("buys commodity and returns portfolio entry", async () => {
    await patchFlags({ financialCommoditiesEnabled: true, financialCommoditiesTradingEnabled: true });
    const { token } = await createAndLoginUser();

    await request(app)
      .post("/api/v1/financial/transactions")
      .set("token", token)
      .send({
        type: "income",
        amount: 1000,
        description: "Funding commodities wallet",
        cardNumber: "4242424242424242",
        cvv: "123",
      })
      .expect(201);

    const buyRes = await request(app)
      .post("/api/v1/commodities/buy")
      .set("token", token)
      .send({ symbol: "GOLD", quantity: 1.25 })
      .expect(201);

    expect(buyRes.body.success).toBe(true);
    expect(buyRes.body.data.symbol).toBe("GOLD");
    expect(buyRes.body.data.quantity).toBe(1.25);
    expect(buyRes.body.data.totalCost).toBeGreaterThan(0);

    const portfolioRes = await request(app).get("/api/v1/commodities/portfolio").set("token", token).expect(200);

    expect(portfolioRes.body.success).toBe(true);
    expect(Array.isArray(portfolioRes.body.data.holdings)).toBe(true);
    expect(portfolioRes.body.data.holdings.some((item) => item.symbol === "GOLD")).toBe(true);
  });

  it("rejects buy when there are insufficient funds", async () => {
    await patchFlags({ financialCommoditiesEnabled: true, financialCommoditiesTradingEnabled: true });
    const { token } = await createAndLoginUser();

    const res = await request(app)
      .post("/api/v1/commodities/buy")
      .set("token", token)
      .send({ symbol: "PALLADIUM", quantity: 9999 })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Insufficient funds");
  });

  it("sells commodity holdings and updates portfolio", async () => {
    await patchFlags({ financialCommoditiesEnabled: true, financialCommoditiesTradingEnabled: true });
    const { token } = await createAndLoginUser();

    await request(app)
      .post("/api/v1/financial/transactions")
      .set("token", token)
      .send({
        type: "income",
        amount: 1000,
        description: "Funding commodities wallet",
        cardNumber: "4242424242424242",
        cvv: "123",
      })
      .expect(201);

    await request(app).post("/api/v1/commodities/buy").set("token", token).send({ symbol: "GOLD", quantity: 1.0 }).expect(201);

    const sellRes = await request(app)
      .post("/api/v1/commodities/sell")
      .set("token", token)
      .send({ symbol: "GOLD", quantity: 0.4 })
      .expect(201);

    expect(sellRes.body.success).toBe(true);
    expect(sellRes.body.data.symbol).toBe("GOLD");
    expect(sellRes.body.data.quantity).toBe(0.4);
    expect(sellRes.body.data.totalProceeds).toBeGreaterThan(0);

    const portfolioRes = await request(app).get("/api/v1/commodities/portfolio").set("token", token).expect(200);
    const goldHolding = portfolioRes.body?.data?.holdings?.find((item) => item.symbol === "GOLD");
    expect(goldHolding).toBeTruthy();
    expect(goldHolding.quantity).toBeCloseTo(0.6, 4);
  });

  it("rejects sell when quantity exceeds holdings", async () => {
    await patchFlags({ financialCommoditiesEnabled: true, financialCommoditiesTradingEnabled: true });
    const { token } = await createAndLoginUser();

    await request(app)
      .post("/api/v1/financial/transactions")
      .set("token", token)
      .send({
        type: "income",
        amount: 1000,
        description: "Funding commodities wallet",
        cardNumber: "4242424242424242",
        cvv: "123",
      })
      .expect(201);

    await request(app).post("/api/v1/commodities/buy").set("token", token).send({ symbol: "SILVER", quantity: 0.2 }).expect(201);

    const sellRes = await request(app)
      .post("/api/v1/commodities/sell")
      .set("token", token)
      .send({ symbol: "SILVER", quantity: 1.0 })
      .expect(400);

    expect(sellRes.body.success).toBe(false);
    expect(sellRes.body.error).toMatch(/Insufficient quantity/i);
  });
});
