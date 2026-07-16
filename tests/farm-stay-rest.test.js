import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// The Rolnopol bridge (routes/v1/farm-stay.route.js) proxies to the gateway:
// feature-flag gate → session auth → identity header (x-stay-user) → passthrough.
// The gateway port must be known before the app-side client is required.
const GATEWAY_PORT = 4450;
process.env.FARM_STAY_TARGET = `http://localhost:${GATEWAY_PORT}`;
process.env.FARM_STAY_CLIENT_TIMEOUT_MS = "2000";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");

const FLAG = "farmStayEnabled";
const USER = "user-fs-rest";
let token;
let originalFlags;

async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}
async function setFlag(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}

beforeAll(async () => {
  originalFlags = await getFlags();
  token = tokenHelpers.generateToken(USER);
});

afterAll(async () => {
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
});

describe("farm-stay REST bridge — feature flag + auth gating", () => {
  it("returns 404 when the flag is off", async () => {
    await setFlag(false);
    await request(app).get("/api/v1/farm-stay/search").set("token", token).expect(404);
  });

  it("returns 401 with no session (flag on)", async () => {
    await setFlag(true);
    await request(app).get("/api/v1/farm-stay/search").expect(401);
  });
});

describe("farm-stay REST bridge — gateway offline", () => {
  it("returns 503 FARM_STAY_OFFLINE when the gateway is not running", async () => {
    await setFlag(true);
    const res = await request(app).get("/api/v1/farm-stay/search?from=2030-06-10&to=2030-06-12").set("token", token).expect(503);
    expect(res.body.error).toBe("FARM_STAY_OFFLINE");
  });
});

describe("farm-stay REST bridge — full ecosystem up", () => {
  let eco;

  beforeAll(async () => {
    eco = await startEcosystem({ base: GATEWAY_PORT, tag: "rest" });
    await setFlag(true);
  });

  afterAll(async () => {
    if (eco) await eco.stop();
  });

  it("proxies search and forwards the caller's identity (200)", async () => {
    const res = await request(app).get("/api/v1/farm-stay/search?from=2030-06-10&to=2030-06-12&guests=1").set("token", token).expect(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it("derives host identity from the session: a user cannot book their own listing (409)", async () => {
    const created = await request(app)
      .post("/api/v1/farm-stay/properties")
      .set("token", token)
      .send({ name: "Bridge Test Cottage", type: "cottage", capacity: 3, basePrice: 80, district: "Lublin", policy: "flexible" })
      .expect(201);

    const res = await request(app)
      .post("/api/v1/farm-stay/bookings")
      .set("token", token)
      .send({ propertyId: created.body.id, from: "2030-06-10", to: "2030-06-12", guests: 1 })
      .expect(409);
    expect(res.body.error).toMatch(/your own property/i);
  });

  it("passes upstream 4xx through: a missing booking is 404", async () => {
    await request(app).get("/api/v1/farm-stay/bookings/bk-does-not-exist").set("token", token).expect(404);
  });

  it("reports aggregate health through the bridge", async () => {
    const res = await request(app).get("/api/v1/farm-stay/health").set("token", token).expect(200);
    expect(res.body.overall).toBe("SERVING");
  });
});
