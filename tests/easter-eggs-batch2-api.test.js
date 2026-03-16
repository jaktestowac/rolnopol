import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function registerAndLogin(prefix) {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "pass123";

  await request(app)
    .post("/api/v1/register")
    .send({
      email,
      password,
      displayedName: `${prefix}-user`,
    });

  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);
  return {
    token: loginRes.body?.data?.token,
    user: loginRes.body?.data?.user,
  };
}

describe("Easter eggs batch 2", () => {
  let originalFlags;

  beforeAll(async () => {
    const flagsRes = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = flagsRes.body?.data?.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { messengerEnabled: true } })
      .expect(200);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("Black Monolith Ping returns glyph for sig=odyssey", async () => {
    const res = await request(app).get("/api/v1/ping?sig=odyssey").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("pong");
    expect(res.body.meta?.easterEgg?.id).toBe("black-monolith-ping");
    expect(res.body.meta?.easterEgg?.monolithGlyph).toBe("■");
  });

  it("Broken Compass is present in /about payload", async () => {
    const res = await request(app).get("/api/v1/about").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("brokenCompass");
    expect(typeof res.body.data.brokenCompass).toBe("string");
    expect(res.body.data.brokenCompass.length).toBeGreaterThanOrEqual(1);
  });

  it("Ledger Haiku + Red Rain Ledger appear on crafted transaction", async () => {
    const actor = await registerAndLogin("ledgerhaiku");

    const res = await request(app)
      .post("/api/v1/financial/transactions?redRainLedger=1")
      .set("token", actor.token)
      .send({
        type: "income",
        amount: 17.17,
        description: "Seed batch",
        category: "farming",
        cardNumber: "4111111111111111",
        cvv: "123",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.meta?.easterEgg?.id).toBe("ledger-haiku");
    expect(res.body.meta?.redRainLedger?.tearsInRain).toBe(true);
  }, 20000);

  it("Blocklist Paradox appears on third block/unblock cycle", async () => {
    const alice = await registerAndLogin("blockparadox_a");
    const bob = await registerAndLogin("blockparadox_b");

    for (let i = 0; i < 2; i += 1) {
      await request(app).post("/api/v1/users/blocked").set("token", alice.token).send({ userId: bob.user.id }).expect(201);

      const unblockRes = await request(app).delete(`/api/v1/users/blocked/${bob.user.id}`).set("token", alice.token).expect(200);

      expect(unblockRes.body.meta?.easterEgg).toBeUndefined();
    }

    await request(app).post("/api/v1/users/blocked").set("token", alice.token).send({ userId: bob.user.id }).expect(201);

    const thirdUnblockRes = await request(app).delete(`/api/v1/users/blocked/${bob.user.id}`).set("token", alice.token).expect(200);

    expect(thirdUnblockRes.body.meta?.easterEgg?.id).toBe("blocklist-paradox");
  }, 20000);
});
