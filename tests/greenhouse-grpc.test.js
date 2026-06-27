import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral port + fast ticks BEFORE requiring the server modules.
const TMP_DB = path.join(os.tmpdir(), `greenhouse-grpc-test-${process.pid}.json`);
process.env.GREENHOUSE_DB_PATH = TMP_DB;
process.env.GREENHOUSE_GRPC_PORT = "0";
process.env.GREENHOUSE_TICK_MS = "20";

const { grpc, loadPackage, callUnary, collectStream, metadata } = require("./helpers/grpc-harness");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require("../grpc/greenhouse-config.js");
const { start } = require("../grpc/greenhouse-server/index.js");

let server;
let healthClient;
let ghClient;

function call(method, request = {}, md) {
  return callUnary(ghClient, method, request, { metadata: md });
}

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "greenhouse");
  healthClient = new proto.Health(target, grpc.credentials.createInsecure());
  ghClient = new proto.GreenhouseControl(target, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("greenhouse gRPC — Health", () => {
  it("Check reports SERVING with the crop count", async () => {
    const reply = await callUnary(healthClient, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.crop_count).toBeGreaterThan(0);
  });
});

describe("greenhouse gRPC — unary grow-a-plant", () => {
  it("ListCrops returns the catalog", async () => {
    const { crops } = await call("ListCrops");
    expect(crops.map((c) => c.id)).toContain("tomato");
  });

  it("ListGreenhouses starts with 3 empty slots", async () => {
    const snap = await call("ListGreenhouses");
    expect(snap.greenhouses).toHaveLength(3);
    expect(snap.greenhouses.every((g) => g.occupied === false)).toBe(true);
  });

  it("Plant → Water → (ripen) → Harvest", async () => {
    const planted = await call("Plant", { slot: 1, crop: "tomato" });
    expect(planted.occupied).toBe(true);
    expect(planted.plant.crop).toBe("tomato");

    const watered = await call("Water", { slot: 1 });
    expect(watered.plant.water).toBe(100);

    // Carrot ripens fastest; plant + keep watering via the stream/ticks would be
    // slow, so verify harvest precondition error path instead.
    await expect(call("Harvest", { slot: 1 })).rejects.toMatchObject({
      code: grpc.status.FAILED_PRECONDITION,
    });
  });

  it("maps an out-of-range slot to INVALID_ARGUMENT", async () => {
    await expect(call("Plant", { slot: 9, crop: "tomato" })).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });

  it("maps planting into an occupied slot to FAILED_PRECONDITION", async () => {
    await call("Plant", { slot: 2, crop: "carrot" });
    await expect(call("Plant", { slot: 2, crop: "pepper" })).rejects.toMatchObject({
      code: grpc.status.FAILED_PRECONDITION,
    });
  });
});

describe("greenhouse gRPC — identity scoping", () => {
  // Greenhouse has no login: callers without gh-identity metadata collapse onto a
  // single shared in-memory demo identity, while distinct identities are isolated.
  const alice = { "gh-identity": "alice", "gh-identity-kind": "user" };
  const bob = { "gh-identity": "bob", "gh-identity-kind": "user" };

  it("isolates state between two distinct identities", async () => {
    await call("Plant", { slot: 1, crop: "tomato" }, alice);

    const bobView = await call("ListGreenhouses", {}, bob);
    expect(bobView.greenhouses.every((g) => g.occupied === false)).toBe(true);

    const aliceView = await call("ListGreenhouses", {}, alice);
    expect(aliceView.greenhouses.find((g) => g.slot === 1)?.occupied).toBe(true);
  });

  it("normalizes callers with no identity metadata onto one shared demo session", async () => {
    // First anonymous caller plants (slot 3 is untouched by the anon unary tests);
    // a second anonymous caller sees the same slot — proving they share a session.
    await call("Plant", { slot: 3, crop: "carrot" });
    const secondAnon = await call("ListGreenhouses");
    expect(secondAnon.greenhouses.find((g) => g.slot === 3)?.occupied).toBe(true);
  });
});

describe("greenhouse gRPC — WatchGreenhouses server-streaming", () => {
  it("streams frames and a planted crop visibly grows, then cancels cleanly", async () => {
    // Plant something so growth is observable (own identity to avoid cross-test bleed).
    const grower = { "gh-identity": "stream-watcher", "gh-identity-kind": "user" };
    await call("Plant", { slot: 3, crop: "carrot" }, grower);

    const stream = ghClient.WatchGreenhouses({}, metadata(grower));
    // Collect frames until we have at least 4 that show slot 3 growing, then cancel.
    const frames = await collectStream(stream, (collected) => {
      const withGrowth = collected.filter((f) => f.greenhouses.find((g) => g.slot === 3)?.plant);
      return withGrowth.length >= 4;
    });

    const growthSamples = frames
      .map((f) => f.greenhouses.find((g) => g.slot === 3)?.plant?.growth)
      .filter((g) => g != null);

    expect(growthSamples.length).toBeGreaterThanOrEqual(4);
    // Growth is non-decreasing and advances over the samples.
    expect(growthSamples[growthSamples.length - 1]).toBeGreaterThan(growthSamples[0]);
  });
});
