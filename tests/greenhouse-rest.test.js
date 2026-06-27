import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + fixed test port BEFORE requiring the app, client, or service.
const TMP_DB = path.join(os.tmpdir(), `greenhouse-rest-test-${process.pid}.json`);
process.env.GREENHOUSE_DB_PATH = TMP_DB;
process.env.GREENHOUSE_GRPC_PORT = "50072";
process.env.GREENHOUSE_GRPC_TARGET = "localhost:50072";

const app = require("../api/index.js");
const { start } = require("../grpc/greenhouse-server/index.js");
const greenhouseClient = require("../modules/greenhouse/greenhouse-client.js");
const tokenHelpers = require("../helpers/token.helpers.js");

const FLAG = "greenhouseControlRoomEnabled";
const DEMO_HEADER = "x-greenhouse-demo-id";

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

let originalFlags;

beforeAll(async () => {
  originalFlags = await getFlags();
});

afterAll(async () => {
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  greenhouseClient._reset();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("greenhouse REST — feature flag gating", () => {
  it("returns 404 when the flag is off", async () => {
    await setFlag(false);
    await request(app).get("/api/v1/greenhouse").set(DEMO_HEADER, "demo-off1234").expect(404);
  });
});

describe("greenhouse REST — flag on, service unavailable", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("returns 400 with no identity", async () => {
    await request(app).get("/api/v1/greenhouse").expect(400);
  });

  it("returns 503 when the greenhouse service is down", async () => {
    const res = await request(app).get("/api/v1/greenhouse").set(DEMO_HEADER, "demo-down1234").expect(503);
    expect(res.body.error).toMatch(/offline/i);
  });
});

describe("greenhouse REST — flag on, service up", () => {
  let server;
  let userToken;

  beforeAll(async () => {
    await setFlag(true);
    ({ server } = await start());
    greenhouseClient._reset();
    userToken = tokenHelpers.generateToken("user-gh-rest");
  });

  afterAll(() => {
    if (server) server.forceShutdown();
  });

  it("lists the crop catalog", async () => {
    const res = await request(app).get("/api/v1/greenhouse/crops").set(DEMO_HEADER, "demo-cat12345").expect(200);
    expect(res.body.data.crops.map((c) => c.id)).toContain("tomato");
  });

  it("starts a demo visitor with 3 empty slots (identityKind=demo)", async () => {
    const res = await request(app).get("/api/v1/greenhouse").set(DEMO_HEADER, "demo-empty1234").expect(200);
    expect(res.body.data.greenhouses).toHaveLength(3);
    expect(res.body.data.greenhouses.every((g) => g.occupied === false)).toBe(true);
    expect(res.body.meta.identityKind).toBe("demo");
  });

  it("reports identityKind=user for a logged-in user (header token)", async () => {
    const res = await request(app).get("/api/v1/greenhouse").set("token", userToken).expect(200);
    expect(res.body.meta.identityKind).toBe("user");
  });

  it("resolves the user identity from the rolnopolToken cookie (browser path)", async () => {
    const res = await request(app).get("/api/v1/greenhouse").set("Cookie", `rolnopolToken=${userToken}`).expect(200);
    expect(res.body.meta.identityKind).toBe("user");
  });

  it("plants a seed into a slot", async () => {
    const res = await request(app)
      .post("/api/v1/greenhouse/1/plant")
      .set(DEMO_HEADER, "demo-plant1234")
      .send({ crop: "tomato" })
      .expect(200);
    expect(res.body.data.occupied).toBe(true);
    expect(res.body.data.plant.crop).toBe("tomato");
  });

  it("rejects planting into an occupied slot with 409", async () => {
    const demo = "demo-occupied1";
    await request(app).post("/api/v1/greenhouse/1/plant").set(DEMO_HEADER, demo).send({ crop: "tomato" }).expect(200);
    await request(app).post("/api/v1/greenhouse/1/plant").set(DEMO_HEADER, demo).send({ crop: "carrot" }).expect(409);
  });

  it("rejects an out-of-range slot with 400", async () => {
    await request(app)
      .post("/api/v1/greenhouse/9/plant")
      .set(DEMO_HEADER, "demo-range1234")
      .send({ crop: "tomato" })
      .expect(400);
  });

  it("rejects watering an empty slot with 409", async () => {
    await request(app).post("/api/v1/greenhouse/2/water").set(DEMO_HEADER, "demo-water1234").expect(409);
  });

  it("rejects harvesting an unripe plant with 409", async () => {
    const demo = "demo-harvest12";
    await request(app).post("/api/v1/greenhouse/1/plant").set(DEMO_HEADER, demo).send({ crop: "tomato" }).expect(200);
    await request(app).post("/api/v1/greenhouse/1/harvest").set(DEMO_HEADER, demo).expect(409);
  });
});
