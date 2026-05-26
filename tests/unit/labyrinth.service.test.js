import { beforeEach, describe, expect, it, vi } from "vitest";

const labyrinthService = require("../../services/labyrinth.service");

function findAdjacentOpenDirection(snapshot) {
  const { player, grid } = snapshot;
  const candidates = [
    { direction: "up", x: player.x, y: player.y - 1 },
    { direction: "right", x: player.x + 1, y: player.y },
    { direction: "down", x: player.x, y: player.y + 1 },
    { direction: "left", x: player.x - 1, y: player.y },
  ];

  return candidates.find((candidate) => grid[candidate.y]?.[candidate.x]?.open === true) || null;
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
      if ((!cell || cell.open !== true) && !(next.x === target.x && next.y === target.y)) continue;
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

describe("LabyrinthService", () => {
  beforeEach(() => {
    labyrinthService.cheatCodesEnabled = false;
    labyrinthService.resetLabyrinth(
      {
        seed: "service-test-seed",
        width: 15,
        height: 15,
        fogRadius: 2,
        fogEnabled: true,
        theme: "obsidian",
      },
      { logCreation: false },
    );
  });

  it("lists the available themes and size presets", () => {
    const themes = labyrinthService.listThemes();
    const sizes = labyrinthService.listSizes();

    expect(themes.map((theme) => theme.name)).toContain("obsidian");
    expect(themes.map((theme) => theme.name)).toContain("fields");
    expect(themes.every((theme) => typeof theme.scene?.title === "string")).toBe(true);

    expect(sizes.map((size) => size.name)).toEqual(expect.arrayContaining(["tiny", "small", "medium", "big", "huge", "advanced"]));
    expect(sizes.find((size) => size.name === "huge")).toMatchObject({ width: 61, height: 61 });
    expect(sizes.find((size) => size.name === "tiny")).toMatchObject({ width: 15, height: 15 });
  });

  it("accepts public action aliases and records revisioned updates", () => {
    const initial = labyrinthService.getSnapshot();
    const openMove = findAdjacentOpenDirection(initial);

    expect(openMove, "maze start should have an adjacent open cell").toBeTruthy();

    const moveResult = labyrinthService.applyAction("walk", { direction: openMove.direction });

    expect(moveResult.action).toBe("move");
    expect(moveResult.snapshot.player).not.toEqual(initial.player);

    const resetResult = labyrinthService.applyAction("reset-maze", {
      size: "huge",
      seed: "service-test-seed",
      theme: "mint",
    });

    expect(resetResult.action).toBe("reset");
    expect(resetResult.snapshot.maze.size).toBe("huge");
    expect(resetResult.snapshot.theme.name).toBe("mint");
    expect(resetResult.snapshot.revision).toBeGreaterThan(moveResult.snapshot.revision);
  });

  it("returns an empty delta when polling from the current revision", () => {
    const snapshot = labyrinthService.getSnapshot();
    const updates = labyrinthService.getUpdates(snapshot.revision);

    expect(updates.since).toBe(snapshot.revision);
    expect(updates.changed).toBe(false);
    expect(updates.events).toEqual([]);
    expect(updates.snapshot.revision).toBe(snapshot.revision);
  });

  it("reveals the whole map through the public revealAll action", () => {
    const result = labyrinthService.applyAction("revealAll");

    expect(result.action).toBe("revealall");
    expect(result.snapshot.fog.enabled).toBe(false);
    expect(result.snapshot.grid.flat().every((cell) => cell.discovered === true)).toBe(true);
    expect(result.snapshot.grid.flat().every((cell) => cell.visible === true)).toBe(true);
    expect(result.snapshot.stats.reveals).toBe(1);
  });

  it("rejects numeric chat codes when chat codes are disabled", () => {
    expect(() => labyrinthService.applyAction("1")).toThrow("Unknown labyrinth action: 1");
  });

  it("supports additional numeric cheat codes when chat codes are enabled", () => {
    labyrinthService.cheatCodesEnabled = true;

    const initial = labyrinthService.getSnapshot();
    expect(initial.fog.radius).toBe(2);
    expect(initial.fog.enabled).toBe(true);
    expect(initial.stats.reveals).toBe(0);

    const revealResult = labyrinthService.applyAction("2");
    expect(revealResult.action).toBe("reveal");
    expect(revealResult.snapshot.stats.reveals).toBe(1);

    const visionResult = labyrinthService.applyAction("3");
    expect(visionResult.action).toBe("maxvision");
    expect(visionResult.snapshot.fog.radius).toBe(8);
    expect(visionResult.event?.type).toBe("maxVision");

    const fogResult = labyrinthService.applyAction("4");
    expect(fogResult.action).toBe("togglefog");
    expect(fogResult.snapshot.fog.enabled).toBe(false);
    expect(fogResult.event?.type).toBe("toggleFog");
  });

  it("supports the tiny maze preset", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-tiny-seed",
      size: "tiny",
      fogEnabled: true,
      theme: "fields",
    });

    const snapshot = labyrinthService.getSnapshot();

    expect(snapshot.maze.size).toBe("tiny");
    expect(snapshot.maze.width).toBe(15);
    expect(snapshot.maze.height).toBe(15);
  });

  it("creates advanced maze mechanics with key, door, and monster", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-advanced-seed",
      size: "advanced",
      fogEnabled: true,
      theme: "fields",
    });

    const snapshot = labyrinthService.getSnapshot();

    expect(snapshot.maze.size).toBe("advanced");
    expect(snapshot.maze.key).toMatchObject({ collected: false });
    expect(snapshot.maze.door).toMatchObject({ locked: true });
    expect(snapshot.monster).toBeTruthy();
    expect(snapshot.inventory.hasKey).toBe(false);

    const pathToKey = findPath(snapshot, snapshot.player, snapshot.maze.key);
    const pathToDoor = findPath(snapshot, snapshot.player, snapshot.maze.door);

    expect(pathToKey, "expected a path to the key").toBeTruthy();
    expect(pathToDoor, "expected a path to the door").toBeTruthy();
    expect(pathToKey.length).toBeLessThan(pathToDoor.length);
  });

  it("moves the monster toward the player after a successful move", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-monster-seed",
      size: "advanced",
      fogEnabled: true,
      theme: "obsidian",
    });

    const before = labyrinthService.getSnapshot();
    const openMove = findAdjacentOpenDirection(before);

    expect(openMove, "maze start should have an adjacent open cell").toBeTruthy();

    const monsterBefore = before.monster;
    const moveResult = labyrinthService.applyAction("move", { direction: openMove.direction });

    const after = labyrinthService.getSnapshot();
    const monsterAfter = after.monster;

    expect(monsterAfter).not.toEqual(monsterBefore);
    expect(moveResult.event?.details?.monster).toMatchObject({
      from: monsterBefore,
      to: monsterAfter,
    });
    expect(Math.abs(monsterAfter.x - monsterBefore.x) + Math.abs(monsterAfter.y - monsterBefore.y)).toBe(1);
  });

  it("ends the game when the monster catches the player", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-gameover-seed",
      size: "advanced",
      fogEnabled: true,
      theme: "obsidian",
    });

    let snapshot = labyrinthService.getSnapshot();
    let result = null;

    for (let index = 0; index < 120 && snapshot.stats.gameOver !== true; index += 1) {
      const pathToMonster = findPath(snapshot, snapshot.player, snapshot.monster);
      expect(pathToMonster, "expected a path toward the monster").toBeTruthy();
      expect(pathToMonster.length).toBeGreaterThan(1);

      const step = pathToMonster[1];
      const direction = directionBetween(snapshot.player, step);
      expect(direction, `expected a valid move from ${snapshot.player.x},${snapshot.player.y} to ${step.x},${step.y}`).toBeTruthy();

      result = labyrinthService.applyAction("move", { direction });
      snapshot = result.snapshot;

      if (result.event?.type === "gameOver") {
        break;
      }
    }

    expect(result.event?.type).toBe("gameOver");
    expect(snapshot.stats.gameOver).toBe(true);
    expect(result.event.details.reason).toBe("monster");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(/monster|game over|captured|caught/i.test(result.message)).toBe(true);
    expect(result.event.details.message).toBe(result.message);
  });

  it("logs when a new maze is created", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      labyrinthService.applyAction("reset-maze", {
        seed: "service-console-seed",
        size: "huge",
        theme: "mint",
      });

      expect(consoleSpy.mock.calls.some(([message]) => typeof message === "string" && message.includes("New maze created"))).toBe(true);
      expect(
        consoleSpy.mock.calls.some(
          ([message, data]) => message === "[INFO]    Data:" && typeof data === "string" && data.includes('"size": "huge"'),
        ),
      ).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("returns a victory message when the player reaches the exit", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-exit-seed",
      width: 15,
      height: 15,
      fogRadius: 2,
      fogEnabled: true,
      theme: "fields",
    });

    const snapshot = labyrinthService.getSnapshot();
    const path = findPath(snapshot, snapshot.player, snapshot.maze.exit);

    expect(path, "expected a path to the exit").toBeTruthy();

    let current = snapshot.player;
    let result = null;
    for (const step of path.slice(1)) {
      const direction = directionBetween(current, step);
      expect(direction, `expected a valid move from ${current.x},${current.y} to ${step.x},${step.y}`).toBeTruthy();
      result = labyrinthService.applyAction("move", { direction });
      current = result.snapshot.player;
    }

    expect(result.message).toContain("You reached the exit! A new maze is ready.");
    expect(result.message).toContain("?");
    expect(result.event.type).toBe("exitReached");
    expect(result.snapshot.stats.solved).toBe(true);
  });

  it("returns a 20x20 viewport snapshot for large mazes", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-viewport-seed",
      width: 61,
      height: 61,
      fogRadius: 4,
      fogEnabled: true,
      theme: "obsidian",
    });

    const snapshot = labyrinthService.getSnapshot({ viewportSize: 20, compact: true });

    expect(snapshot.viewport).toMatchObject({ width: 20, height: 20 });
    expect(snapshot.grid).toHaveLength(20);
    expect(snapshot.grid[0]).toHaveLength(20);
    expect(snapshot.grid.flat().every((cell) => typeof cell.t === "string")).toBe(true);
  });

  it("returns fogged cells for non-visible tiles when requested", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-fogged-seed",
      width: 61,
      height: 61,
      fogRadius: 2,
      fogEnabled: true,
      theme: "obsidian",
    });

    const snapshot = labyrinthService.getSnapshot({ viewportSize: 20, fogged: true, compact: true });
    const foggedCell = snapshot.grid.flat().find((cell) => cell.t === "fog");

    expect(foggedCell).toBeTruthy();
    expect(foggedCell.v).toBeUndefined();
  });

  it("generates exactly two scrolls with cryptic text", () => {
    labyrinthService.resetLabyrinth({
      seed: "service-scroll-seed",
      width: 31,
      height: 31,
      fogRadius: 2,
      fogEnabled: false,
      theme: "fields",
    });

    const snapshot = labyrinthService.getSnapshot({ compact: true });
    const scrollCells = snapshot.grid.flat().filter((cell) => cell.t === "scroll");

    expect(snapshot.maze.scrolls).toHaveLength(2);
    expect(scrollCells).toHaveLength(2);
    expect(snapshot.maze.scrolls.every((scroll) => typeof scroll.text === "string" && scroll.text.length > 0)).toBe(true);
  });
});
