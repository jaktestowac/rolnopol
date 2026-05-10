import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const labyrinthService = require("../services/labyrinth.service");

async function resetLabyrinth() {
  await request(app)
    .post("/api/v1/labyrinth/actions")
    .send({
      action: "reset",
      payload: {
        seed: "maze-test-seed",
        width: 15,
        height: 15,
        fogRadius: 2,
        fogEnabled: true,
        theme: "obsidian",
      },
    })
    .expect(200);
}

function labyrinthSession(sessionId) {
  return {
    get(path) {
      return request(app).get(path).set("x-labyrinth-session-id", sessionId);
    },
    post(path) {
      return request(app).post(path).set("x-labyrinth-session-id", sessionId);
    },
  };
}

function getLinePoints(from, to) {
  const points = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }

    const doubleErr = err * 2;
    if (doubleErr > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (doubleErr < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return points;
}

function findBlockedTarget(snapshot, maxRadius = 8) {
  const origin = snapshot.player;
  for (let y = 0; y < snapshot.maze.height; y += 1) {
    for (let x = 0; x < snapshot.maze.width; x += 1) {
      const cell = snapshot.grid[y][x];
      if (!cell || cell.wall || cell.player) {
        continue;
      }

      const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      if (distance === 0 || distance > maxRadius) {
        continue;
      }

      const points = getLinePoints(origin, { x, y });
      const blocked = points.slice(1, -1).some((point) => snapshot.grid[point.y]?.[point.x]?.wall === true);
      if (blocked) {
        return { x, y };
      }
    }
  }

  return null;
}

function findOpenNeighborOfExit(snapshot) {
  const exit = snapshot.maze.exit;
  const candidates = [
    { x: exit.x, y: exit.y - 1 },
    { x: exit.x + 1, y: exit.y },
    { x: exit.x, y: exit.y + 1 },
    { x: exit.x - 1, y: exit.y },
  ];

  return candidates.find((candidate) => snapshot.grid[candidate.y]?.[candidate.x]?.open === true) || null;
}

function findAdjacentOpenDirection(snapshot) {
  const origin = snapshot.player;
  const candidates = [
    { direction: "up", x: origin.x, y: origin.y - 1 },
    { direction: "right", x: origin.x + 1, y: origin.y },
    { direction: "down", x: origin.x, y: origin.y + 1 },
    { direction: "left", x: origin.x - 1, y: origin.y },
  ];

  return candidates.find((candidate) => snapshot.grid[candidate.y]?.[candidate.x]?.open === true) || null;
}

function findPathToTarget(snapshot, start, target) {
  const queue = [{ x: start.x, y: start.y, path: [{ x: start.x, y: start.y }] }];
  const visited = new Set([`${start.x},${start.y}`]);
  const directions = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === target.x && current.y === target.y) {
      return current.path;
    }

    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;
      const cell = snapshot.grid[next.y]?.[next.x];
      if (!cell || cell.open !== true) continue;
      visited.add(key);
      queue.push({ x: next.x, y: next.y, path: [...current.path, next] });
    }
  }

  return null;
}

function findPath(snapshot, start, target) {
  const queue = [{ x: start.x, y: start.y, path: [{ x: start.x, y: start.y }] }];
  const visited = new Set([`${start.x},${start.y}`]);
  const directions = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === target.x && current.y === target.y) {
      return current.path;
    }

    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;
      const cell = snapshot.grid[next.y]?.[next.x];
      if (!cell || cell.open !== true) continue;
      visited.add(key);
      queue.push({ x: next.x, y: next.y, path: [...current.path, next] });
    }
  }

  return null;
}

function directionBetween(from, to) {
  if (to.x === from.x + 1 && to.y === from.y) return "right";
  if (to.x === from.x - 1 && to.y === from.y) return "left";
  if (to.x === from.x && to.y === from.y + 1) return "down";
  if (to.x === from.x && to.y === from.y - 1) return "up";
  return null;
}

describe("Labyrinth API and hidden page", () => {
  beforeEach(async () => {
    await resetLabyrinth();
  });

  it("serves the hidden operator page", async () => {
    const res = await request(app).get("/operator/labyrinth.html").expect(200);
    expect(res.text).toContain("Labyrinth");
    expect(res.text).toContain("mazeGrid");
    expect(res.text).toContain("mazeSizeModal");
    expect(res.text).toContain('data-maze-size="tiny"');
    expect(res.text).toContain('data-maze-size="huge"');
    expect(res.text).toContain('data-maze-size="advanced"');
    expect(res.text).toContain("mazeGameOverModal");
    expect(res.text).toContain("mazeGameOverMessage");
    expect(res.text).not.toContain("Configuration");
  });

  it("redirects the short operator route to the html page", async () => {
    const res = await request(app).get("/operator/labyrinth").expect(302);
    expect(res.headers.location).toBe("/operator/labyrinth.html");
  });

  it("returns a maze snapshot with theme and fog metadata", async () => {
    const res = await request(app).get("/api/v1/labyrinth").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.maze.width).toBe(15);
    expect(res.body.data.maze.height).toBe(15);
    expect(res.body.data.theme.name).toBe("obsidian");
    expect(Array.isArray(res.body.data.grid)).toBe(true);
    expect(res.body.data.grid.length).toBe(15);
    expect(res.body.data.grid[0].length).toBe(15);
    expect(res.body.data.grid.flat().some((cell) => cell.t === "fog")).toBe(true);
    expect(res.body.data.capabilities.actions).toContain("move");
    expect(res.body.data.capabilities.actions).toContain("configure");
    expect(res.body.data.capabilities.actions).toContain("revealAll");
    expect(res.body.data.capabilities.sizes.map((size) => size.name)).toContain("medium");
    expect(res.body.data.theme.scene.title).toContain("maze");
  });

  it("returns no update delta when polling from the current revision", async () => {
    const snapshotRes = await request(app).get("/api/v1/labyrinth").expect(200);
    const currentRevision = snapshotRes.body.data.revision;

    const updatesRes = await request(app).get(`/api/v1/labyrinth/updates?since=${currentRevision}`).expect(200);

    expect(updatesRes.body.success).toBe(true);
    expect(updatesRes.body.data.since).toBe(currentRevision);
    expect(updatesRes.body.data.changed).toBe(false);
    expect(updatesRes.body.data.events).toEqual([]);
  });

  it("keeps separate maze state per browser session", async () => {
    const sessionA = "browser-session-a";
    const sessionB = "browser-session-b";

    await labyrinthSession(sessionA)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-browser-a",
          width: 15,
          height: 15,
          fogRadius: 2,
          fogEnabled: true,
          theme: "obsidian",
        },
      })
      .expect(200);

    await labyrinthSession(sessionB)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-browser-b",
          width: 15,
          height: 15,
          fogRadius: 2,
          fogEnabled: true,
          theme: "obsidian",
        },
      })
      .expect(200);

    const sessionASnapshot = labyrinthService.getSnapshot({ sessionId: sessionA });
    const sessionBSnapshot = labyrinthService.getSnapshot({ sessionId: sessionB });
    const openMove = findAdjacentOpenDirection(sessionASnapshot);

    expect(openMove, "expected session A to have an adjacent open cell").toBeTruthy();

    await labyrinthSession(sessionA)
      .post("/api/v1/labyrinth/actions")
      .send({ action: "move", payload: { direction: openMove.direction } })
      .expect(200);

    const updatedA = await labyrinthSession(sessionA).get("/api/v1/labyrinth").expect(200);
    const updatedB = await labyrinthSession(sessionB).get("/api/v1/labyrinth").expect(200);

    expect(updatedA.body.data.player).not.toEqual(sessionASnapshot.player);
    expect(updatedA.body.data.revision).toBeGreaterThan(sessionASnapshot.revision);
    expect(updatedB.body.data.player).toEqual(sessionBSnapshot.player);
    expect(updatedB.body.data.revision).toBe(sessionBSnapshot.revision);
  });

  it("accepts the type alias on the actions endpoint", async () => {
    const res = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        type: "reset",
        payload: {
          size: "huge",
          theme: "mint",
          seed: "maze-test-seed",
          fogEnabled: true,
        },
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.action).toBe("reset");
    expect(res.body.data.snapshot.maze.size).toBe("huge");
    expect(res.body.data.snapshot.theme.name).toBe("mint");
    expect(res.body.data.snapshot.maze.width).toBe(61);
  });

  it("rejects unknown labyrinth actions", async () => {
    const res = await request(app).post("/api/v1/labyrinth/actions").send({ action: "does-not-exist", payload: {} }).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Unknown labyrinth action");
  });

  it("reveals the full map when the reveal-all action is used", async () => {
    const res = await request(app).post("/api/v1/labyrinth/actions").send({ action: "revealAll", payload: {} }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.action).toBe("revealall");
    expect(res.body.data.snapshot.fog.enabled).toBe(false);
    expect(res.body.data.snapshot.grid.flat().every((cell) => cell.t !== "fog")).toBe(true);
    expect(res.body.data.snapshot.grid.flat().every((cell) => cell.v === 1)).toBe(true);
  });

  it("supports bigger and more complex maze presets", async () => {
    const mediumRes = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-test-seed",
          size: "medium",
          fogEnabled: true,
          theme: "fields",
        },
      })
      .expect(200);

    const hugeRes = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-test-seed",
          size: "huge",
          fogEnabled: true,
          theme: "fields",
        },
      })
      .expect(200);

    expect(mediumRes.body.data.snapshot.maze.size).toBe("medium");
    expect(hugeRes.body.data.snapshot.maze.size).toBe("huge");
    expect(hugeRes.body.data.snapshot.maze.width).toBeGreaterThan(mediumRes.body.data.snapshot.maze.width);
    expect(hugeRes.body.data.snapshot.maze.complexity).toBeGreaterThan(mediumRes.body.data.snapshot.maze.complexity);
    expect(hugeRes.body.data.snapshot.viewport).toMatchObject({ width: 20, height: 20 });
    expect(hugeRes.body.data.snapshot.grid).toHaveLength(20);
    expect(hugeRes.body.data.snapshot.grid[0]).toHaveLength(20);
    expect(hugeRes.body.data.snapshot.grid.flat().some((cell) => cell.t === "fog")).toBe(true);
  });

  it("generates two scrolls and emits a pickup event when one is collected", async () => {
    const resetRes = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-scroll-seed",
          width: 31,
          height: 31,
          fogEnabled: false,
          theme: "fields",
        },
      })
      .expect(200);

    expect(resetRes.body.data.snapshot.maze.scrolls).toHaveLength(2);

    const internalSnapshot = labyrinthService.getSnapshot();
    const targetScroll = internalSnapshot.maze.scrolls[0];
    expect(targetScroll).toBeTruthy();

    const path = findPathToTarget(internalSnapshot, internalSnapshot.player, targetScroll);
    expect(path, "expected a path to the generated scroll").toBeTruthy();

    let current = internalSnapshot.player;
    let pickupResponse = null;
    for (const step of path.slice(1)) {
      const direction = directionBetween(current, step);
      expect(direction, `expected a valid move from ${current.x},${current.y} to ${step.x},${step.y}`).toBeTruthy();

      pickupResponse = await request(app).post("/api/v1/labyrinth/actions").send({ action: "move", payload: { direction } }).expect(200);

      current = pickupResponse.body.data.snapshot.player;
    }

    expect(pickupResponse.body.data.event.type).toBe("scrollPickedUp");
    expect(pickupResponse.body.data.event.details.scroll.text).toEqual(expect.any(String));
    expect(pickupResponse.body.data.snapshot.maze.scrolls.length).toBeLessThan(2);
  });

  it("applies move actions and exposes incremental updates", async () => {
    const initialRes = await request(app).get("/api/v1/labyrinth").expect(200);
    const initial = initialRes.body.data;
    const internalInitial = labyrinthService.getSnapshot();
    const start = initial.player;
    const startCell = internalInitial.grid[start.y][start.x];
    expect(startCell.player).toBe(true);

    const candidateDirections = [
      { direction: "up", x: start.x, y: start.y - 1 },
      { direction: "right", x: start.x + 1, y: start.y },
      { direction: "down", x: start.x, y: start.y + 1 },
      { direction: "left", x: start.x - 1, y: start.y },
    ];

    const openMove = candidateDirections.find((candidate) => {
      if (candidate.x < 0 || candidate.y < 0 || candidate.x >= initial.maze.width || candidate.y >= initial.maze.height) {
        return false;
      }
      return internalInitial.grid[candidate.y][candidate.x].open === true;
    });

    expect(openMove, "maze start should have an adjacent open cell").toBeTruthy();

    const moveRes = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({ action: "move", payload: { direction: openMove.direction } })
      .expect(200);

    expect(moveRes.body.success).toBe(true);
    expect(moveRes.body.data.snapshot.revision).toBeGreaterThan(initial.revision);
    expect(moveRes.body.data.snapshot.player).not.toEqual(start);

    const resetRes = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-test-seed",
          width: 15,
          height: 15,
          fogRadius: 2,
          fogEnabled: true,
          theme: "fields",
        },
      })
      .expect(200);

    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.data.snapshot.stats.moves).toBe(0);
    expect(resetRes.body.data.snapshot.player).toEqual(resetRes.body.data.snapshot.maze.start);

    const updatesRes = await request(app).get(`/api/v1/labyrinth/updates?since=${initial.revision}`).expect(200);
    expect(updatesRes.body.success).toBe(true);
    expect(updatesRes.body.data.changed).toBe(true);
    expect(updatesRes.body.data.events.length).toBeGreaterThan(0);
  });

  it("accepts theme updates through the action endpoint", async () => {
    const res = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({ action: "setTheme", payload: { theme: "fields" } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.snapshot.theme.name).toBe("fields");
    expect(res.body.data.snapshot.theme.scene.walls).toBe("crop rows");
    expect(res.body.data.snapshot.theme.scene.player).toBe("tractor");
  });

  it("does not discover cells behind walls", async () => {
    const res = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-test-seed",
          width: 15,
          height: 15,
          fogRadius: 8,
          fogEnabled: true,
          theme: "fields",
        },
      })
      .expect(200);

    const internalSnapshot = labyrinthService.getSnapshot();
    const snapshot = res.body.data.snapshot;
    const blockedTarget = findBlockedTarget(internalSnapshot, 8);
    expect(blockedTarget, "expected at least one blocked target within fog radius").toBeTruthy();

    const hiddenCell = snapshot.grid[blockedTarget.y][blockedTarget.x];
    expect(hiddenCell.t).toBe("fog");
  });

  it("reveals the exit after uncovering fog of war", async () => {
    const res = await request(app)
      .post("/api/v1/labyrinth/actions")
      .send({
        action: "reset",
        payload: {
          seed: "maze-test-seed",
          width: 15,
          height: 15,
          fogRadius: 8,
          fogEnabled: true,
          theme: "fields",
        },
      })
      .expect(200);

    const snapshot = res.body.data.snapshot;
    const internalSnapshot = labyrinthService.getSnapshot();
    const exit = snapshot.maze.exit;
    const exitCell = snapshot.grid[exit.y][exit.x];

    expect(exitCell.t).toBe("fog");

    const exitNeighbor = findOpenNeighborOfExit(internalSnapshot);
    expect(exitNeighbor, "expected the exit to have at least one open neighboring cell").toBeTruthy();

    const path = findPath(internalSnapshot, internalSnapshot.player, exitNeighbor);
    expect(path, "expected a path from the player to a cell beside the exit").toBeTruthy();

    let current = snapshot.player;
    for (const step of path.slice(1)) {
      const direction = directionBetween(current, step);
      expect(direction, `expected a valid move from ${current.x},${current.y} to ${step.x},${step.y}`).toBeTruthy();

      const moveRes = await request(app).post("/api/v1/labyrinth/actions").send({ action: "move", payload: { direction } }).expect(200);

      current = moveRes.body.data.snapshot.player;
    }

    const revealedRes = await request(app).get("/api/v1/labyrinth").expect(200);
    const revealedSnapshot = revealedRes.body.data;
    const revealedExitCell = revealedSnapshot.grid[exit.y][exit.x];

    expect(revealedExitCell.t).toBe("exit");
    expect(revealedExitCell.v).toBe(1);
  });

  it("returns a victory message and exitReached event when the player reaches the exit", async () => {
    const snapshotRes = await request(app).get("/api/v1/labyrinth").expect(200);
    const initialRevision = snapshotRes.body.data.revision;
    const internalSnapshot = labyrinthService.getSnapshot();
    const path = findPath(internalSnapshot, internalSnapshot.player, internalSnapshot.maze.exit);

    expect(path, "expected a path to the exit").toBeTruthy();

    let current = internalSnapshot.player;
    let moveRes = null;
    for (const step of path.slice(1)) {
      const direction = directionBetween(current, step);
      expect(direction, `expected a valid move from ${current.x},${current.y} to ${step.x},${step.y}`).toBeTruthy();

      moveRes = await request(app).post("/api/v1/labyrinth/actions").send({ action: "move", payload: { direction } }).expect(200);
      current = moveRes.body.data.snapshot.player;
    }

    expect(moveRes.body.message).toContain("You reached the exit! A new maze is ready.");
    expect(moveRes.body.message).toContain("?");
    expect(moveRes.body.data.event.type).toBe("exitReached");
    expect(moveRes.body.data.snapshot.stats.solved).toBe(true);

    const updatesRes = await request(app).get(`/api/v1/labyrinth/updates?since=${initialRevision}`).expect(200);
    expect(updatesRes.body.message).toContain("You reached the exit! A new maze is ready.");
    expect(updatesRes.body.message).toContain("?");
    expect(updatesRes.body.data.events.at(-1).type).toBe("exitReached");
  });
});
