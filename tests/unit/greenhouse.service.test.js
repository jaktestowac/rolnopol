import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Point the greenhouse store at a throwaway file BEFORE requiring the modules
// that build the JSONDatabase singleton.
const TMP_DB = path.join(os.tmpdir(), `greenhouse-service-test-${process.pid}.json`);
process.env.GREENHOUSE_DB_PATH = TMP_DB;

const greenhouseDb = require("../../grpc/greenhouse-server/db.js");
const greenhouseService = require("../../grpc/greenhouse-server/greenhouse.service.js");

const USER = { kind: "user", id: "user-1" };
const DEMO = { kind: "demo", id: "demo-abc123" };

beforeAll(async () => {
  await greenhouseDb.init();
});

beforeEach(async () => {
  await greenhouseDb.db.replaceAll({ version: 2, users: {}, updatedAt: null });
  greenhouseService._resetSessions();
});

afterAll(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("greenhouse.service — listCrops / listGreenhouses", () => {
  it("returns the crop catalog", () => {
    const { crops } = greenhouseService.listCrops();
    expect(crops.length).toBeGreaterThan(0);
    expect(crops.map((c) => c.id)).toContain("tomato");
    expect(crops[0]).toHaveProperty("emoji");
  });

  it("starts a fresh identity with 3 empty slots", async () => {
    const snap = await greenhouseService.listGreenhouses(DEMO);
    expect(snap.greenhouses).toHaveLength(3);
    expect(snap.greenhouses.every((g) => g.occupied === false)).toBe(true);
    expect(snap.harvested).toBe(0);
  });
});

describe("greenhouse.service — plant", () => {
  it("plants a seed into an empty slot", async () => {
    const gh = await greenhouseService.plant(DEMO, 1, "tomato");
    expect(gh.slot).toBe(1);
    expect(gh.occupied).toBe(true);
    expect(gh.plant.crop).toBe("tomato");
    expect(gh.plant.growth).toBe(0);
    expect(gh.plant.water).toBe(100);
    expect(gh.plant.stage).toBe("seed");
  });

  it("rejects an out-of-range slot with INVALID_ARGUMENT", async () => {
    await expect(greenhouseService.plant(DEMO, 9, "tomato")).rejects.toMatchObject({ type: "INVALID_ARGUMENT" });
  });

  it("rejects an unknown crop with INVALID_ARGUMENT", async () => {
    await expect(greenhouseService.plant(DEMO, 1, "moonrock")).rejects.toMatchObject({ type: "INVALID_ARGUMENT" });
  });

  it("rejects planting into an occupied slot with FAILED_PRECONDITION", async () => {
    await greenhouseService.plant(DEMO, 1, "tomato");
    await expect(greenhouseService.plant(DEMO, 1, "carrot")).rejects.toMatchObject({ type: "FAILED_PRECONDITION" });
  });
});

describe("greenhouse.service — water", () => {
  it("refills water to 100", async () => {
    await greenhouseService.plant(DEMO, 2, "carrot");
    const session = await greenhouseService.listGreenhouses(DEMO); // touch session
    expect(session.greenhouses[1].plant.water).toBe(100);
    const gh = await greenhouseService.water(DEMO, 2);
    expect(gh.plant.water).toBe(100);
  });

  it("rejects watering an empty slot", async () => {
    await expect(greenhouseService.water(DEMO, 3)).rejects.toMatchObject({ type: "FAILED_PRECONDITION" });
  });
});

describe("greenhouse.service — harvest", () => {
  it("rejects harvesting an unripe plant", async () => {
    await greenhouseService.plant(DEMO, 1, "tomato");
    await expect(greenhouseService.harvest(DEMO, 1)).rejects.toMatchObject({ type: "FAILED_PRECONDITION" });
  });

  it("harvests a ripe plant, empties the slot, increments count", async () => {
    await greenhouseService.plant(USER, 1, "tomato");
    // Force ripeness via the live session object.
    const session = greenhouseService._sessions.get("user:user-1");
    session.greenhouses[0].plant.growth = 100;

    const result = await greenhouseService.harvest(USER, 1);
    expect(result.harvested_crop).toBe("tomato");
    expect(result.harvested).toBe(1);
    expect(result.greenhouse.occupied).toBe(false);
  });
});

describe("greenhouse.service — per-identity persistence", () => {
  it("persists a user's greenhouses to the store", async () => {
    await greenhouseService.plant(USER, 1, "pepper");
    const onDisk = JSON.parse(fs.readFileSync(TMP_DB, "utf8"));
    expect(onDisk.users[USER.id].greenhouses[0].plant.crop).toBe("pepper");
  });

  it("reloads a user's greenhouses after sessions are cleared", async () => {
    await greenhouseService.plant(USER, 2, "strawberry");
    greenhouseService._resetSessions();
    const snap = await greenhouseService.listGreenhouses(USER);
    expect(snap.greenhouses[1].occupied).toBe(true);
    expect(snap.greenhouses[1].plant.crop).toBe("strawberry");
  });

  it("keeps demo state in memory only (not persisted, isolated from users)", async () => {
    await greenhouseService.plant(DEMO, 1, "tomato");
    const onDisk = JSON.parse(fs.readFileSync(TMP_DB, "utf8"));
    expect(onDisk.users[DEMO.id]).toBeUndefined();

    const userSnap = await greenhouseService.listGreenhouses(USER);
    expect(userSnap.greenhouses[0].occupied).toBe(false);
  });
});
