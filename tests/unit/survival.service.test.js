/**
 * Rolnopol Survival — expedition record rules (PRD 10, WP-40 to WP-43).
 *
 * Runs against a throwaway database file so the repository's own data/ folder is
 * never touched.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const TMP_DB = path.join(os.tmpdir(), `survival-service-test-${process.pid}.json`);
process.env.SURVIVAL_SESSIONS_DB_PATH = TMP_DB;

const service = require("../../services/survival/survival.service");
const repository = require("../../services/survival/session-repository");

const ALICE = "user-survival-alice";
const BOB = "user-survival-bob";

beforeAll(async () => {
  await repository._resetForTests();
});

beforeEach(async () => {
  await repository._resetForTests();
});

afterAll(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("survival service — WP-40 the store", () => {
  it("writes the declared shape, version first", async () => {
    await service.startSession({ userId: ALICE });
    const data = await repository.db.getAll();

    expect(data.version).toBe(repository.STORE_VERSION);
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(typeof data.updatedAt).toBe("string");
  });

  it("leaves room for a saved run without filling it", async () => {
    const { session } = await service.startSession({ userId: ALICE });
    expect(session.snapshot).toBeNull();
    expect(session.result).toBeNull();
  });
});

describe("survival service — WP-41 starting an expedition", () => {
  it("opens a record before the first move, with a server seed", async () => {
    const { session } = await service.startSession({ userId: ALICE, scenarioId: "lost", difficulty: "hard" });

    expect(session.status).toBe("in_progress");
    expect(session.scenarioId).toBe("lost");
    expect(session.difficulty).toBe("hard");
    expect(session.mapSource).toBe("generated");
    expect(Number.isInteger(session.seed)).toBe(true);
    expect(session.seed).toBeGreaterThan(0);
  });

  it("accepts a seed the player brought, so a known map can be replayed", async () => {
    const { session } = await service.startSession({ userId: ALICE, seed: 4242 });
    expect(session.seed).toBe(4242);
  });

  it("refuses a seed that is not a positive integer", async () => {
    await expect(service.startSession({ userId: ALICE, seed: "abc" })).rejects.toMatchObject({ status: 400 });
    await expect(service.startSession({ userId: ALICE, seed: -3 })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an unknown scenario or difficulty", async () => {
    await expect(service.startSession({ userId: ALICE, scenarioId: "hunting-party" })).rejects.toMatchObject({ status: 400 });
    await expect(service.startSession({ userId: ALICE, difficulty: "brutal" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("survival service — WP-42 closing an expedition", () => {
  it("records a win and a loss the same way, differing only in status", async () => {
    const win = await service.startSession({ userId: ALICE });
    const closedWin = await service.closeSession({
      userId: ALICE,
      sessionId: win.session.id,
      status: "won",
      result: { days: 9, hexesTravelled: 24, health: 4, water: 2, food: 3, eventsSeen: 0, forcedMarches: 1 },
    });

    const loss = await service.startSession({ userId: ALICE });
    const closedLoss = await service.closeSession({
      userId: ALICE,
      sessionId: loss.session.id,
      status: "lost",
      result: { days: 9, hexesTravelled: 24, health: 0, water: 0, food: 3, eventsSeen: 0, forcedMarches: 1 },
    });

    expect(closedWin.status).toBe("won");
    expect(closedLoss.status).toBe("lost");
    expect(Object.keys(closedWin.result)).toEqual(Object.keys(closedLoss.result));
    expect(typeof closedWin.finishedAt).toBe("string");
  });

  it("clamps results to the ranges the game can produce and drops unknown fields", () => {
    const result = service.sanitizeResult({
      days: 12.9,
      hexesTravelled: 30,
      health: 99,
      water: -5,
      food: 4,
      eventsSeen: 2,
      forcedMarches: 1,
      score: 999999,
      cheated: true,
    });

    expect(result.days).toBe(12);
    expect(result.health).toBe(10);
    expect(result.water).toBe(0);
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("cheated");
  });

  it("refuses a result that is not an object or carries no numbers", () => {
    expect(() => service.sanitizeResult(null)).toThrow();
    expect(() => service.sanitizeResult({ days: "many" })).toThrow();
  });

  it("refuses a second close on the same expedition", async () => {
    const { session } = await service.startSession({ userId: ALICE });
    const result = { days: 3, hexesTravelled: 4, health: 0, water: 0, food: 0, eventsSeen: 0, forcedMarches: 0 };

    await service.closeSession({ userId: ALICE, sessionId: session.id, status: "lost", result });
    await expect(service.closeSession({ userId: ALICE, sessionId: session.id, status: "won", result })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("hides other players' expeditions behind a 404", async () => {
    const { session } = await service.startSession({ userId: ALICE });
    const result = { days: 1, hexesTravelled: 0, health: 1, water: 1, food: 1, eventsSeen: 0, forcedMarches: 0 };

    await expect(service.closeSession({ userId: BOB, sessionId: session.id, status: "won", result })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.getSession(BOB, session.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("survival service — the scoreboard (PRD 8.11)", () => {
  async function finish(userId, status, options) {
    const { session } = await service.startSession({ userId });
    await service.closeSession({
      userId,
      sessionId: session.id,
      status,
      result: { days: 5, hexesTravelled: 9, health: 1, water: 1, food: 1, eventsSeen: 0, forcedMarches: 0 },
      cheatsUsed: !!(options && options.cheated),
    });
  }

  it("counts wins and losses per player and ranks by wins", async () => {
    await finish("1", "won");
    await finish("1", "won");
    await finish("1", "lost");
    await finish("2", "won");

    const board = await service.getScoreboard("1");

    expect(board[0]).toMatchObject({ rank: 1, wins: 2, losses: 1 });
    expect(board[1]).toMatchObject({ rank: 2, wins: 1, losses: 0 });
  });

  it("breaks a tie on wins by who lost less getting there", async () => {
    await finish("1", "won");
    await finish("1", "lost");
    await finish("1", "lost");
    await finish("2", "won");

    const board = await service.getScoreboard("1");

    expect(board[0].wins).toBe(board[1].wins);
    expect(board[0].losses).toBeLessThan(board[1].losses);
  });

  it("leaves a cheated expedition out entirely, win or loss", async () => {
    await finish("1", "won");
    await finish("2", "won", { cheated: true });
    await finish("2", "lost", { cheated: true });

    const board = await service.getScoreboard("1");

    expect(board).toHaveLength(1);
    expect(board[0].wins).toBe(1);
  });

  it("counts only finished expeditions, not open or abandoned ones", async () => {
    await service.startSession({ userId: "1" });
    await service.startSession({ userId: "1" }); // abandons the first

    expect(await service.getScoreboard("1")).toEqual([]);
  });

  it("names the players and marks the row of whoever is looking", async () => {
    await finish("1", "won");
    await finish("2", "won");

    const board = await service.getScoreboard("2");
    const mine = board.find((entry) => entry.you);

    expect(mine).toBeTruthy();
    expect(board.every((entry) => typeof entry.name === "string" && entry.name.length > 0)).toBe(true);
  });

  it("shows a name even for a player the user store has never heard of", async () => {
    await finish("ghost-user", "won");
    const board = await service.getScoreboard("1");

    expect(board[0].name).toBe("Unknown");
  });

  it("stops at ten", async () => {
    for (let i = 0; i < 14; i += 1) await finish("player-" + i, "won");

    expect(await service.getScoreboard("1")).toHaveLength(service.SCOREBOARD_LIMIT);
  });

  it("gives nothing to a caller with no session", async () => {
    await expect(service.getScoreboard(null)).rejects.toMatchObject({ status: 401 });
  });

  it("hands out no seeds, journals or saved runs", async () => {
    await finish("1", "won");
    const board = await service.getScoreboard("2");

    expect(Object.keys(board[0]).sort()).toEqual(["losses", "name", "rank", "wins", "you"]);
  });
});

describe("survival service — WP-43 one open expedition per player", () => {
  it("abandons the previous run when a new one starts", async () => {
    const first = await service.startSession({ userId: ALICE });
    const second = await service.startSession({ userId: ALICE });

    expect(second.abandoned).toBe(1);

    const mine = await service.listSessions(ALICE);
    const open = mine.filter((session) => session.status === "in_progress");

    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(second.session.id);

    const abandoned = mine.find((session) => session.id === first.session.id);
    expect(abandoned.status).toBe("abandoned");
    expect(typeof abandoned.finishedAt).toBe("string");
  });

  it("does not touch another player's open run", async () => {
    const bob = await service.startSession({ userId: BOB });
    await service.startSession({ userId: ALICE });
    await service.startSession({ userId: ALICE });

    const bobSessions = await service.listSessions(BOB);
    expect(bobSessions).toHaveLength(1);
    expect(bobSessions[0].id).toBe(bob.session.id);
    expect(bobSessions[0].status).toBe("in_progress");
  });

  it("lists only the caller's expeditions, newest first, capped", async () => {
    for (let i = 0; i < 3; i += 1) await service.startSession({ userId: ALICE });
    await service.startSession({ userId: BOB });

    const mine = await service.listSessions(ALICE);
    expect(mine).toHaveLength(3);
    expect(mine.every((session) => session.userId === ALICE)).toBe(true);
    expect(await service.listSessions(ALICE, 2)).toHaveLength(2);
  });
});
