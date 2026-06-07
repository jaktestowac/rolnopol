import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const farmDefenceService = require("../services/fd.service");

async function resetFarmDefence(payload = {}) {
  await request(app)
    .post("/api/v1/fd/actions")
    .send({
      action: "reset",
      payload: {
        seed: "fd-test-seed",
        size: "tiny",
        ...payload,
      },
    })
    .expect(200);
}

function fdSession(sessionId) {
  return {
    get(path) {
      return request(app).get(path).set("x-fd-session-id", sessionId);
    },
    post(path) {
      return request(app).post(path).set("x-fd-session-id", sessionId);
    },
  };
}

describe("Farm Defence API", () => {
  beforeEach(async () => {
    await resetFarmDefence();
  });

  it("returns initial snapshot with map and resources", async () => {
    const res = await request(app).get("/api/v1/fd").expect(200);
    const snapshot = res.body.data;
    expect(snapshot).toBeDefined();
    expect(snapshot.map).toBeDefined();
    expect(snapshot.map.width).toBe(11);
    expect(snapshot.map.height).toBe(11);
    expect(snapshot.resources).toBeDefined();
    expect(snapshot.resources.gold).toBeGreaterThan(0);
    expect(snapshot.resources.lives).toBeGreaterThan(0);
    expect(snapshot.wave).toBeDefined();
    expect(snapshot.stats).toBeDefined();
    expect(snapshot.capabilities).toBeDefined();
  });

  it("returns updates since revision", async () => {
    const initial = await request(app).get("/api/v1/fd").expect(200);
    const rev = initial.body.data.revision;

    const updates = await request(app).get(`/api/v1/fd/updates?since=${rev}`).expect(200);
    expect(updates.body.data.changed).toBe(false);
  });

  it("places a tower on buildable cell and deducts gold", async () => {
    const before = await request(app).get("/api/v1/fd").expect(200);
    const goldBefore = before.body.data.resources.gold;

    // Find a buildable cell
    const grid = before.body.data.grid;
    let buildableX = -1,
      buildableY = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "buildable") {
          buildableX = x;
          buildableY = y;
          break;
        }
      }
      if (buildableX >= 0) break;
    }
    expect(buildableX).toBeGreaterThanOrEqual(0);

    const res = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: buildableX, y: buildableY, type: "archer" } })
      .expect(200);

    expect(res.body.data.action).toBe("placeTower");
    expect(res.body.data.snapshot.resources.gold).toBeLessThan(goldBefore);
  });

  it("rejects tower placement on path cell", async () => {
    const before = await request(app).get("/api/v1/fd").expect(200);
    const grid = before.body.data.grid;

    // Find a path cell
    let pathX = -1,
      pathY = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "path") {
          pathX = x;
          pathY = y;
          break;
        }
      }
      if (pathX >= 0) break;
    }
    if (pathX < 0) return; // Skip if no path cell visible

    const res = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: pathX, y: pathY, type: "archer" } });

    expect(res.status).toBe(400);
  });

  it("rejects tower placement when insufficient gold", async () => {
    // Reset with tiny gold
    await resetFarmDefence({ startGold: 5 });

    const res = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: 0, y: 0, type: "cannon" } });

    expect(res.status).toBe(400);
  });

  it("rejects unknown tower type", async () => {
    const res = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: 0, y: 0, type: "laser" } });

    expect(res.status).toBe(400);
  });

  it("starts a wave", async () => {
    const res = await request(app).post("/api/v1/fd/actions").send({ action: "startWave" }).expect(200);

    expect(res.body.data.action).toBe("startWave");
    expect(res.body.data.snapshot.wave.status).toBe("active");
  });

  it("tick moves simulation forward during active wave", async () => {
    // Start a wave first
    await request(app).post("/api/v1/fd/actions").send({ action: "startWave" }).expect(200);

    // Tick
    const res = await request(app).post("/api/v1/fd/actions").send({ action: "tick" }).expect(200);

    expect(res.body.data.action).toBe("tick");
  });

  it("supports action aliases", async () => {
    const res = await request(app).post("/api/v1/fd/actions").send({ action: "next" }).expect(200);

    expect(res.body.data.action).toBe("startWave");
  });

  it("isolates sessions via x-fd-session-id header", async () => {
    const sess1 = fdSession("session-1");
    const sess2 = fdSession("session-2");

    // Reset both sessions
    await sess1
      .post("/api/v1/fd/actions")
      .send({ action: "reset", payload: { seed: "fd-s1", size: "tiny" } })
      .expect(200);
    await sess2
      .post("/api/v1/fd/actions")
      .send({ action: "reset", payload: { seed: "fd-s2", size: "tiny" } })
      .expect(200);

    // Place tower in session 1
    const before1 = await sess1.get("/api/v1/fd").expect(200);
    const grid1 = before1.body.data.grid;
    let bx = -1,
      by = -1;
    for (let y = 0; y < grid1.length; y++) {
      for (let x = 0; x < grid1[y].length; x++) {
        if (grid1[y][x].t === "buildable") {
          bx = x;
          by = y;
          break;
        }
      }
      if (bx >= 0) break;
    }
    if (bx < 0) return;

    await sess1
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: bx, y: by, type: "archer" } })
      .expect(200);

    // Session 2 should not have the tower
    const state2 = await sess2.get("/api/v1/fd").expect(200);
    const hasTower = state2.body.data.towers.some((t) => t.x === bx && t.y === by);
    expect(hasTower).toBe(false);
  });

  it("capabilities include all registered tower types (including fire)", async () => {
    const res = await request(app).get("/api/v1/fd").expect(200);
    const caps = res.body.data.capabilities;
    expect(caps.towerTypes).toContain("archer");
    expect(caps.towerTypes).toContain("cannon");
    expect(caps.towerTypes).toContain("frost");
    expect(caps.towerTypes).toContain("fire");
    expect(caps.enemyTypes).toContain("grunt");
    expect(caps.enemyTypes).toContain("scout");
    expect(caps.enemyTypes).toContain("brute");
    expect(caps.enemyTypes).toContain("boss");
  });

  it("supports upgradeTower action", async () => {
    const before = await request(app).get("/api/v1/fd").expect(200);
    const grid = before.body.data.grid;
    let bx = -1,
      by = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "buildable") {
          bx = x;
          by = y;
          break;
        }
      }
      if (bx >= 0) break;
    }
    if (bx < 0) return;

    const placed = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: bx, y: by, type: "archer" } })
      .expect(200);

    const towerId = placed.body.data.snapshot.towers.find((t) => t.x === bx && t.y === by).id;
    const goldAfterPlace = placed.body.data.snapshot.resources.gold;

    const res = await request(app).post("/api/v1/fd/actions").send({ action: "upgradeTower", payload: { towerId } }).expect(200);

    expect(res.body.data.action).toBe("upgradeTower");
    expect(res.body.data.snapshot.resources.gold).toBeLessThan(goldAfterPlace);
  });

  it("supports setTheme action", async () => {
    const res = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "setTheme", payload: { theme: "fields" } })
      .expect(200);

    expect(res.body.data.snapshot.theme).toBe("fields");
  });

  it("supports sellTower action", async () => {
    const before = await request(app).get("/api/v1/fd").expect(200);
    const grid = before.body.data.grid;
    let bx = -1,
      by = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "buildable") {
          bx = x;
          by = y;
          break;
        }
      }
      if (bx >= 0) break;
    }
    if (bx < 0) return;

    const placed = await request(app)
      .post("/api/v1/fd/actions")
      .send({ action: "placeTower", payload: { x: bx, y: by, type: "archer" } })
      .expect(200);

    const towerId = placed.body.data.snapshot.towers.find((t) => t.x === bx && t.y === by).id;

    const res = await request(app).post("/api/v1/fd/actions").send({ action: "sellTower", payload: { towerId } }).expect(200);

    expect(res.body.data.action).toBe("sellTower");
  });
});
