/**
 * Rolnopol Survival — reasons to go out again (PRD 8.18, faza D).
 *
 * Three things share this file because they share one rule: a run that used the
 * cheat console counts for nothing. Marks, personal bests and the unlock ladder
 * all read the same history, and the scoreboard already settled why (PRD 6.24).
 *
 * The achievements are checked for reachability rather than one at a time. A
 * mark nobody can earn is the failure mode that matters, and a list of twelve
 * hand-written assertions would restate the table instead of testing it.
 */
import { describe, it, expect } from "vitest";

const achievements = require("../../public/js/games/survival/achievements.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const strings = require("../../public/js/games/survival/strings.js");
const service = require("../../services/survival/survival.service.js");
const repository = require("../../services/survival/session-repository.js");
const game = require("../../public/js/games/survival/game.js");

function run(overrides) {
  return {
    finished: true,
    won: false,
    cheatsUsed: false,
    scenarioId: "lost",
    mapSize: "standard",
    difficulty: "normal",
    days: 7,
    hexesTravelled: 20,
    trailHexes: 0,
    camps: 0,
    cabinsUsed: 0,
    woundsTaken: 0,
    forcedMarches: 1,
    eventsSeen: 2,
    health: 5,
    water: 3,
    food: 3,
    fatigue: 2,
    orientation: 6,
    markersInspected: 0,
    carriedSurvivor: false,
    wounded: false,
    ...overrides,
  };
}

/** A run built to earn one particular mark, for the reachability sweep. */
const EARNS = {
  firstExpedition: {},
  wayOut: { won: true },
  tenDays: { days: 12 },
  swift: { won: true, days: 4 },
  parched: { won: true, water: 0 },
  unscathed: { won: true, health: 10, forcedMarches: 0 },
  roadWise: { won: true, hexesTravelled: 18, trailHexes: 6 },
  walkItOff: { won: true, woundsTaken: 2, cabinsUsed: 0 },
  straightToIt: { won: true, scenarioId: "search", markersInspected: 1 },
  stretcherBearer: { won: true, scenarioId: "rescue", carriedSurvivor: true },
  outran: { won: true, scenarioId: "chase" },
  longHaul: { won: true, mapSize: "vast" },
};

function record(overrides) {
  return {
    id: "r" + Math.random().toString(16).slice(2),
    userId: "u1",
    scenarioId: "lost",
    mapSize: "standard",
    difficulty: "normal",
    status: "won",
    cheatsUsed: false,
    challengeDate: null,
    achievements: [],
    result: { days: 6, hexesTravelled: 20 },
    ...overrides,
  };
}

describe("survival marks — twelve reasons to go out again", () => {
  it("can be earned, every one of them", () => {
    for (const id of achievements.ids()) {
      expect(achievements.evaluate(run(EARNS[id])), id + " is unreachable").toContain(id);
    }
  });

  it("has a name and an explanation for each", () => {
    for (const id of achievements.ids()) {
      for (const key of ["achievement." + id + ".name", "achievement." + id + ".description"]) {
        expect(strings.has(key), key + " is missing").toBe(true);
      }
    }
  });

  it("gives an unfinished run nothing at all", () => {
    expect(achievements.evaluate(run({ finished: false, won: false }))).toEqual([]);
  });

  it("gives a cheated run nothing, however it ended", () => {
    expect(achievements.evaluate(run({ ...EARNS.wayOut, cheatsUsed: true }))).toEqual([]);
  });

  it("keeps the declared order, so the end screen reads the same way twice", () => {
    const earned = achievements.evaluate(run({ won: true, days: 3, water: 0, health: 10, forcedMarches: 0 }));
    const declared = achievements.ids();

    expect(earned).toEqual(declared.filter((id) => earned.includes(id)));
  });

  it("drops an id this build has never heard of", () => {
    expect(achievements.sanitize(["wayOut", "goldenBoots", "wayOut"])).toEqual(["wayOut"]);
    expect(achievements.sanitize("wayOut")).toEqual([]);
  });

  it("reads a finished run and touches nothing", () => {
    const state = game.createGame({ seed: 4, scenarioId: "lost", difficulty: "normal", events: false });
    const before = JSON.stringify(state.player);

    achievements.evaluate(game.describeRun(state));
    expect(JSON.stringify(state.player)).toBe(before);
  });
});

describe("survival expeditions — all of them, from the first visit (PRD 6.31)", () => {
  it("opens every expedition to a player with no history at all", () => {
    expect(scenarios.unlockedScenarios({ finished: 0, wins: 0 }).sort()).toEqual(scenarios.listScenarios().sort());
  });

  it("asks nothing of anybody", () => {
    for (const id of scenarios.listScenarios()) {
      expect(scenarios.requirementFor(id), id + " still wants something").toBeNull();
      expect(scenarios.isUnlocked(id, { finished: 0, wins: 0 }), id + " is locked").toBe(true);
    }
  });

  it("still knows how to hold one back, if a rung is ever put back", () => {
    // The table is empty by decision, not because the machinery went away. This
    // puts one rung back for the length of the test and takes it out again, so
    // the seam stays proven while nothing ships locked.
    const kept = scenarios.UNLOCKS.chase;
    scenarios.UNLOCKS.chase = { finished: 2, wins: 1 };

    try {
      expect(scenarios.isUnlocked("chase", { finished: 0, wins: 0 })).toBe(false);
      expect(scenarios.isUnlocked("chase", { finished: 2, wins: 0 })).toBe(false);
      expect(scenarios.isUnlocked("chase", { finished: 2, wins: 1 })).toBe(true);
      expect(scenarios.isUnlocked("lost", { finished: 0, wins: 0 }), "Lost is never held back").toBe(true);
    } finally {
      scenarios.UNLOCKS.chase = kept;
    }
  });
});

describe("survival record — personal bests (PRD 8.18)", () => {
  it("keeps one row per expedition and map size, because those are not the same run", () => {
    const rows = service.personalRecords([
      record({ scenarioId: "lost", mapSize: "standard" }),
      record({ scenarioId: "lost", mapSize: "endless" }),
      record({ scenarioId: "search", mapSize: "standard" }),
    ]);

    expect(rows).toHaveLength(3);
  });

  it("takes the fastest escape, not the fastest run", () => {
    const rows = service.personalRecords([
      record({ status: "won", result: { days: 9, hexesTravelled: 30 } }),
      record({ status: "lost", result: { days: 2, hexesTravelled: 4 } }),
      record({ status: "won", result: { days: 5, hexesTravelled: 22 } }),
    ]);

    expect(rows[0].bestDays).toBe(5);
    expect(rows[0].longestSurvived, "the longest is the longest, win or lose").toBe(9);
    expect(rows[0].attempts).toBe(3);
    expect(rows[0].wins).toBe(2);
  });

  it("leaves out the runs that were helped", () => {
    const rows = service.personalRecords([record({ cheatsUsed: true, result: { days: 1, hexesTravelled: 2 } }), record({})]);

    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].bestDays).toBe(6);
  });

  it("ignores an expedition still under way", () => {
    expect(service.personalRecords([record({ status: "in_progress", result: null })])).toEqual([]);
  });
});

describe("survival record — the daily streak (PRD 8.18)", () => {
  const day = (date, status) => record({ challengeDate: date, status: status || "lost" });

  it("counts a run of days", () => {
    const streak = service.dailyStreak([day("2026-08-25"), day("2026-08-26"), day("2026-08-27")], "2026-08-27");

    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.playedToday).toBe(true);
    expect(streak.lastDate).toBe("2026-08-27");
  });

  it("keeps a streak alive until the day is actually missed", () => {
    const streak = service.dailyStreak([day("2026-08-25"), day("2026-08-26")], "2026-08-27");

    expect(streak.current, "today is still open, not lost").toBe(2);
    expect(streak.playedToday).toBe(false);
  });

  it("breaks when a day goes by unplayed", () => {
    const streak = service.dailyStreak([day("2026-08-20"), day("2026-08-21"), day("2026-08-27")], "2026-08-27");

    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(2);
  });

  it("counts a day once, however many times it was started", () => {
    const streak = service.dailyStreak([day("2026-08-27"), day("2026-08-27"), day("2026-08-27")], "2026-08-27");
    expect(streak.current).toBe(1);
  });

  it("does not count a challenge that was opened and walked away from", () => {
    const streak = service.dailyStreak([day("2026-08-27", "abandoned"), day("2026-08-26", "in_progress")], "2026-08-27");
    expect(streak).toEqual({ current: 0, longest: 0, lastDate: null, playedToday: false });
  });

  it("crosses a month end without tripping", () => {
    const streak = service.dailyStreak([day("2026-07-31"), day("2026-08-01")], "2026-08-01");
    expect(streak.current).toBe(2);
  });
});

describe("survival record — what a close may write down (PRD 8.17)", () => {
  it("keeps a moment as day, key and kind, and nothing else", () => {
    const kept = service.sanitizeMoments([{ day: 3, key: "log.win", kind: "good", text: "a sentence" }]);
    expect(kept).toEqual([{ day: 3, key: "log.win", kind: "good" }]);
  });

  it("drops what it cannot read rather than refusing the result", () => {
    expect(service.sanitizeMoments([null, 7, { day: 1 }, { key: "log.win" }])).toEqual([{ day: 1, key: "log.win", kind: "event" }]);
    expect(service.sanitizeMoments("the whole story")).toEqual([]);
  });

  it("caps the story at what the end screen shows", () => {
    const many = Array.from({ length: 40 }, (unused, i) => ({ day: i + 1, key: "event.k" + i, kind: "event" }));
    expect(service.sanitizeMoments(many)).toHaveLength(service.MAX_MOMENTS);
  });

  it("keeps a route as whole pairs", () => {
    expect(service.sanitizeRoute([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4]);
    expect(service.sanitizeRoute([1.7, -2.3])).toEqual([1, -2]);
    expect(service.sanitizeRoute(["north", 2])).toEqual([]);
  });

  it("caps a route long before it can grow the store", () => {
    const long = Array.from({ length: 9000 }, () => 1);
    expect(service.sanitizeRoute(long).length).toBeLessThanOrEqual(service.MAX_ROUTE_LENGTH);
  });
});

describe("survival record — the store moved shape once (PRD 8.14, debt)", () => {
  it("reads a record written before any of this existed", () => {
    const old = { version: 1, sessions: [{ id: "a", userId: "u1", scenarioId: "lost", status: "won" }] };
    const migrated = repository.migrateStore(old);

    expect(migrated.version).toBe(repository.STORE_VERSION);
    expect(migrated.sessions[0]).toMatchObject({
      id: "a",
      cheatsUsed: false,
      challengeDate: null,
      moments: [],
      route: [],
      achievements: [],
    });
  });

  it("never overwrites what a record already says", () => {
    const kept = repository.migrateStore({
      version: 1,
      sessions: [{ id: "b", cheatsUsed: true, challengeDate: "2026-01-01", achievements: ["wayOut"] }],
    });

    expect(kept.sessions[0].cheatsUsed).toBe(true);
    expect(kept.sessions[0].challengeDate).toBe("2026-01-01");
    expect(kept.sessions[0].achievements).toEqual(["wayOut"]);
  });

  it("survives a store with nothing usable in it", () => {
    expect(repository.migrateStore({ version: 1 }).sessions).toEqual([]);
    expect(repository.migrateStore({ version: 1, sessions: "none" }).sessions).toEqual([]);
  });
});
