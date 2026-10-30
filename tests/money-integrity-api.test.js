import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function registerUser(label) {
  const user = {
    email: `money_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}@test.com`,
    displayedName: `Money_${label}`,
    password: "testpass123",
  };
  const res = await request(app).post("/api/v1/register").send(user);
  expect(res.status, `register ${label}: ${JSON.stringify(res.body)}`).toBe(201);
  return { token: res.body.data.token, id: res.body.data.user.id };
}

async function deposit(user, amount) {
  await request(app)
    .post("/api/v1/financial/transactions")
    .set("token", user.token)
    .send({ type: "income", amount, description: "Test deposit", cardNumber: "4242424242424242", cvv: "123" })
    .expect(201);
}

async function balanceOf(user) {
  const res = await request(app).get("/api/v1/financial/account").set("token", user.token).expect(200);
  return res.body.data.account.balance;
}

describe("Money integrity API", () => {
  it("marketplace purchase pays the seller and charges the buyer", async () => {
    const seller = await registerUser("seller");
    const buyer = await registerUser("buyer");
    await deposit(buyer, 200);

    const fieldRes = await request(app).post("/api/v1/fields").set("token", seller.token).send({ name: "Money Field", area: 5 });
    expect(fieldRes.status, JSON.stringify(fieldRes.body)).toBe(201);
    const offerRes = await request(app)
      .post("/api/v1/marketplace/offers")
      .set("token", seller.token)
      .send({ itemType: "field", itemId: fieldRes.body.data.id, price: 75.5, description: "Money test field" });
    expect(offerRes.body.success, JSON.stringify(offerRes.body)).toBe(true);

    const sellerBefore = await balanceOf(seller);
    const buyerBefore = await balanceOf(buyer);

    const buyRes = await request(app)
      .post("/api/v1/marketplace/buy")
      .set("token", buyer.token)
      .send({ offerId: offerRes.body.data.offer.id });
    expect(buyRes.status, JSON.stringify(buyRes.body)).toBe(200);
    expect(buyRes.body.data.transaction).toMatchObject({ sellerId: seller.id, buyerId: buyer.id, price: 75.5 });

    expect(await balanceOf(seller)).toBe(sellerBefore + 75.5);
    expect(await balanceOf(buyer)).toBe(buyerBefore - 75.5);
  });

  it("rejects an offer with a non-numeric price", async () => {
    const seller = await registerUser("badprice");
    const fieldRes = await request(app).post("/api/v1/fields").set("token", seller.token).send({ name: "Bad Price Field", area: 5 });

    const res = await request(app)
      .post("/api/v1/marketplace/offers")
      .set("token", seller.token)
      .send({ itemType: "field", itemId: fieldRes.body.data.id, price: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Price must be greater than 0");
  });

  it("rejects a transfer to yourself when toUserId is sent as a number", async () => {
    const user = await registerUser("self");
    await deposit(user, 100);
    const before = await balanceOf(user);

    const res = await request(app)
      .post("/api/v1/financial/transfer")
      .set("token", user.token)
      .send({ toUserId: Number(user.id), amount: 10, description: "Self transfer" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("yourself");
    expect(await balanceOf(user)).toBe(before);
  });

  it("parallel transfers cannot spend the same balance twice", async () => {
    const sender = await registerUser("sender");
    const first = await registerUser("first");
    const second = await registerUser("second");
    await deposit(sender, 100);
    const before = await balanceOf(sender);

    const responses = await Promise.all(
      [first, second].map((recipient) =>
        request(app)
          .post("/api/v1/financial/transfer")
          .set("token", sender.token)
          .send({ toUserId: recipient.id, amount: before - 30, description: "Race transfer" }),
      ),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await balanceOf(sender)).toBe(30);
    expect((await balanceOf(first)) + (await balanceOf(second))).toBe(before - 30);
  });

  it("keeps cents exact across many small deposits", async () => {
    const user = await registerUser("cents");
    const before = await balanceOf(user);

    for (let i = 0; i < 10; i++) {
      await deposit(user, 0.1);
    }

    expect(await balanceOf(user)).toBe(Math.round((before + 1) * 100) / 100);
  });
});
