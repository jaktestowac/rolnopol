/**
 * Rolnopol Survival — expedition record API (PRD 10, WP-39, WP-41 to WP-44).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway database BEFORE the app (and therefore the repository) is required.
const TMP_DB = path.join(os.tmpdir(), `survival-rest-test-${process.pid}.json`);
process.env.SURVIVAL_SESSIONS_DB_PATH = TMP_DB;

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const repository = require("../services/survival/session-repository.js");

const FLAG = "survivalGameEnabled";
const BASE = "/api/v1/survival/sessions";

const FULL_RESULT = { days: 7, hexesTravelled: 19, health: 3, water: 1, food: 4, eventsSeen: 0, forcedMarches: 2 };

/**
 * Play out a history, for the tests that need one behind them: personal bests,
 * the streak, and the marks a player has collected (PRD 8.18).
 */
async function earnHistory(token, { wins = 0, losses = 0, cheated = false } = {}) {
  for (let i = 0; i < wins + losses; i += 1) {
    const started = await request(app).post(BASE).set("token", token).send({ scenarioId: "lost" }).expect(201);
    await request(app)
      .patch(BASE + "/" + started.body.data.session.id)
      .set("token", token)
      .send({ status: i < wins ? "won" : "lost", result: FULL_RESULT, cheatsUsed: cheated })
      .expect(200);
  }
}

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
let aliceToken;
let bobToken;

beforeAll(async () => {
  originalFlags = await getFlags();
  aliceToken = tokenHelpers.generateToken("survival-alice");
  bobToken = tokenHelpers.generateToken("survival-bob");
});

beforeEach(async () => {
  await repository._resetForTests();
});

afterAll(async () => {
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("survival REST — WP-44 feature flag", () => {
  it("answers 404 while the module is off, even with a valid session", async () => {
    await setFlag(false);
    await request(app).get(BASE).set("token", aliceToken).expect(404);
    await request(app).post(BASE).set("token", aliceToken).send({}).expect(404);
  });
});

describe("survival REST — WP-39 authentication", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("answers 401 without a session", async () => {
    await request(app).get(BASE).expect(401);
    await request(app).post(BASE).send({}).expect(401);
  });

  it("does not accept a personal API key in place of a session", async () => {
    await request(app).get(BASE).set("x-api-key", "not-a-session").expect(401);
  });
});

describe("survival REST — WP-41 starting an expedition", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("creates an open record carrying a server seed", async () => {
    const res = await request(app).post(BASE).set("token", aliceToken).send({ difficulty: "hard" }).expect(201);
    const session = res.body.data.session;

    expect(session.status).toBe("in_progress");
    expect(session.difficulty).toBe("hard");
    expect(Number.isInteger(session.seed)).toBe(true);
    expect(session.userId).toBe("survival-alice");

    const stored = await request(app)
      .get(BASE + "/" + session.id)
      .set("token", aliceToken)
      .expect(200);
    expect(stored.body.data.session.id).toBe(session.id);
  });

  it("ignores a userId smuggled in through the body", async () => {
    const res = await request(app).post(BASE).set("token", aliceToken).send({ userId: "survival-bob" }).expect(201);

    expect(res.body.data.session.userId).toBe("survival-alice");
  });

  it("accepts every scenario the game ships, from a brand new account (WP-112)", async () => {
    for (const scenarioId of ["lost", "survival", "search", "rescue", "deadline", "chase"]) {
      const res = await request(app).post(BASE).set("token", aliceToken).send({ scenarioId }).expect(201);
      expect(res.body.data.session.scenarioId).toBe(scenarioId);
      expect(res.body.data.session.mapSource).toBe("generated");
    }
  });

  it("holds nothing back from a player who has never finished a run (WP-112)", async () => {
    // No history whatever, and the hardest expedition still starts.
    const res = await request(app).post(BASE).set("token", aliceToken).send({ scenarioId: "chase" }).expect(201);
    expect(res.body.data.session.scenarioId).toBe("chase");
  });

  it("reports every expedition as open (WP-112)", async () => {
    const res = await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(200);
    const rows = res.body.data.progress.scenarios;

    expect(rows.every((row) => row.unlocked)).toBe(true);
    expect(rows.every((row) => row.requires === null)).toBe(true);
  });

  it("hands everybody the same map on the same day (WP-67)", async () => {
    const mine = await request(app).post(BASE).set("token", aliceToken).send({ daily: true }).expect(201);
    const theirs = await request(app).post(BASE).set("token", bobToken).send({ daily: true }).expect(201);

    expect(mine.body.data.session.seed).toBe(theirs.body.data.session.seed);
    expect(mine.body.data.session.challengeDate).toBe(theirs.body.data.session.challengeDate);
    expect(mine.body.data.session.challengeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fixes the scenario and the difficulty of a daily, so it can be compared", async () => {
    const res = await request(app)
      .post(BASE)
      .set("token", aliceToken)
      .send({ daily: true, scenarioId: "hunting-party", difficulty: "easy", mapSize: "vast", seed: 4242 })
      .expect(201);

    expect(res.body.data.session.scenarioId).toBe("lost");
    expect(res.body.data.session.difficulty).toBe("normal");
    expect(res.body.data.session.mapSize).toBe("standard");
    expect(res.body.data.session.seed).not.toBe(4242);
  });

  it("leaves an ordinary expedition unmarked", async () => {
    const res = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    expect(res.body.data.session.challengeDate).toBeNull();
  });

  it("records the map size the player picked, so the seed still describes a map", async () => {
    const res = await request(app).post(BASE).set("token", aliceToken).send({ mapSize: "large" }).expect(201);

    expect(res.body.data.session.mapSize).toBe("large");
  });

  it("defaults the map size when the player says nothing", async () => {
    const res = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    expect(res.body.data.session.mapSize).toBe("standard");
  });

  it("refuses a map size nobody defined", async () => {
    await request(app).post(BASE).set("token", aliceToken).send({ mapSize: "continental" }).expect(400);
  });

  it("rejects nonsense input with 400", async () => {
    await request(app).post(BASE).set("token", aliceToken).send({ scenarioId: "hunting-party" }).expect(400);
    await request(app).post(BASE).set("token", aliceToken).send({ seed: "soon" }).expect(400);
  });
});

describe("survival REST — the record (PRD 8.18)", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("answers with an empty record for somebody who has never played", async () => {
    const res = await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(200);
    const progress = res.body.data.progress;

    expect(progress.totals).toMatchObject({ finished: 0, wins: 0 });
    expect(progress.records).toEqual([]);
    expect(progress.streak.current).toBe(0);
    expect(progress.achievements.every((mark) => mark.earned === false)).toBe(true);
    expect(
      progress.scenarios.every((row) => row.unlocked),
      "every expedition is open from the start",
    ).toBe(true);
  });

  it("keeps the story, the route and the marks a finished run sends", async () => {
    const started = await request(app).post(BASE).set("token", aliceToken).send({ scenarioId: "lost" }).expect(201);

    await request(app)
      .patch(BASE + "/" + started.body.data.session.id)
      .set("token", aliceToken)
      .send({
        status: "won",
        result: FULL_RESULT,
        moments: [{ day: 2, key: "log.win", kind: "good" }],
        route: [0, 0, 1, 0, 1, 1],
        achievements: ["wayOut", "no-such-mark"],
      })
      .expect(200);

    const stored = await request(app)
      .get(BASE + "/" + started.body.data.session.id)
      .set("token", aliceToken)
      .expect(200);

    expect(stored.body.data.session.moments).toEqual([{ day: 2, key: "log.win", kind: "good" }]);
    expect(stored.body.data.session.route).toEqual([0, 0, 1, 0, 1, 1]);
    expect(stored.body.data.session.achievements, "an id this build does not know is dropped").toEqual(["wayOut"]);
  });

  it("gives a cheated expedition no marks, whatever it claims", async () => {
    const started = await request(app).post(BASE).set("token", aliceToken).send({ scenarioId: "lost" }).expect(201);

    await request(app)
      .patch(BASE + "/" + started.body.data.session.id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT, cheatsUsed: true, achievements: ["wayOut"] })
      .expect(200);

    const res = await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(200);
    expect(res.body.data.progress.achievements.find((mark) => mark.id === "wayOut").earned).toBe(false);
    expect(res.body.data.progress.totals.finished).toBe(0);
  });

  it("builds the personal bests out of what was actually played", async () => {
    await earnHistory(aliceToken, { wins: 1, losses: 1 });

    const res = await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(200);
    const rows = res.body.data.progress.records;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scenarioId: "lost", mapSize: "standard", attempts: 2, wins: 1, bestDays: FULL_RESULT.days });
  });

  it("shows nobody else's record", async () => {
    await earnHistory(bobToken, { wins: 3, losses: 3 });

    const res = await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(200);
    expect(res.body.data.progress.totals.finished).toBe(0);
  });

  it("stays behind the feature flag and the session, like everything else", async () => {
    await request(app).get("/api/v1/survival/progress").expect(401);

    await setFlag(false);
    await request(app).get("/api/v1/survival/progress").set("token", aliceToken).expect(404);
    await setFlag(true);
  });
});

describe("survival REST — WP-42 closing an expedition", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("stores the outcome and the summary", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    const res = await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(200);

    expect(res.body.data.session.status).toBe("won");
    expect(res.body.data.session.result).toEqual(FULL_RESULT);
    expect(res.body.data.session.finishedAt).toBeTruthy();
  });

  it("refuses a second close with 409", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "lost", result: FULL_RESULT })
      .expect(200);
    await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(409);
  });

  it("records that a run used the cheat console (PRD 8.8)", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    const res = await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "won", result: { ...FULL_RESULT, cheatsUsed: true }, cheatsUsed: true })
      .expect(200);

    expect(res.body.data.session.cheatsUsed).toBe(true);
    // The flag lives beside the result, not inside it: the result only holds
    // the numbers the game can produce.
    expect(res.body.data.session.result.cheatsUsed).toBeUndefined();
  });

  it("leaves an honest run unmarked", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);

    const res = await request(app)
      .patch(BASE + "/" + start.body.data.session.id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(200);

    expect(res.body.data.session.cheatsUsed).toBe(false);
  });

  it("refuses a status outside the closed set", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    await request(app)
      .patch(BASE + "/" + start.body.data.session.id)
      .set("token", aliceToken)
      .send({ status: "in_progress", result: FULL_RESULT })
      .expect(400);
  });
});

describe("survival REST — WP-69 saving a run", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("parks a run and hands it back whole", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .put(BASE + "/" + id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1, day: 4, seed: start.body.data.session.seed } })
      .expect(200);

    const read = await request(app)
      .get(BASE + "/" + id)
      .set("token", aliceToken)
      .expect(200);

    expect(read.body.data.session.snapshot).toEqual({ v: 1, day: 4, seed: start.body.data.session.seed });
    expect(read.body.data.session.status).toBe("in_progress");
  });

  it("flags a saved run in the history without shipping it", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    await request(app)
      .put(BASE + "/" + start.body.data.session.id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1, day: 2 } })
      .expect(200);

    const history = await request(app).get(BASE).set("token", aliceToken).expect(200);
    const row = history.body.data.sessions.find((session) => session.id === start.body.data.session.id);

    expect(row.hasSnapshot).toBe(true);
    expect(row.snapshot).toBeUndefined();
  });

  it("marks the record the moment a saved run says cheats were used", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;
    expect(start.body.data.session.cheatsUsed).toBe(false);

    await request(app)
      .put(BASE + "/" + id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1, day: 2, cheatsUsed: true } })
      .expect(200);

    const read = await request(app)
      .get(BASE + "/" + id)
      .set("token", aliceToken)
      .expect(200);

    // Still open, already marked: abandoning it now cannot wash it off.
    expect(read.body.data.session.status).toBe("in_progress");
    expect(read.body.data.session.cheatsUsed).toBe(true);
  });

  it("keeps the mark on a run that is abandoned rather than finished", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .put(BASE + "/" + id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1, day: 3, cheatsUsed: true } })
      .expect(200);

    // Starting another expedition abandons this one.
    await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);

    const history = await request(app).get(BASE).set("token", aliceToken).expect(200);
    const abandoned = history.body.data.sessions.find((session) => session.id === id);

    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.cheatsUsed).toBe(true);
  });

  it("cannot be scrubbed clean by closing the run without the flag", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .put(BASE + "/" + id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1, day: 2, cheatsUsed: true } })
      .expect(200);

    const closed = await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(200);

    expect(closed.body.data.session.cheatsUsed).toBe(true);
  });

  it("refuses to save into somebody else's run", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);

    await request(app)
      .put(BASE + "/" + start.body.data.session.id + "/snapshot")
      .set("token", bobToken)
      .send({ snapshot: { v: 1 } })
      .expect(404);
  });

  it("refuses to save into a run that is over", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .patch(BASE + "/" + id)
      .set("token", aliceToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(200);

    await request(app)
      .put(BASE + "/" + id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: { v: 1 } })
      .expect(409);
  });

  it("refuses a snapshot that is not an object", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);

    await request(app)
      .put(BASE + "/" + start.body.data.session.id + "/snapshot")
      .set("token", aliceToken)
      .send({ snapshot: "everything" })
      .expect(400);
  });
});

describe("survival REST — the scoreboard (PRD 8.11)", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  async function finish(token, status, cheated) {
    const start = await request(app).post(BASE).set("token", token).send({}).expect(201);
    await request(app)
      .patch(BASE + "/" + start.body.data.session.id)
      .set("token", token)
      .send({ status, result: FULL_RESULT, cheatsUsed: cheated === true })
      .expect(200);
  }

  it("shows every player, not just the caller", async () => {
    await finish(aliceToken, "won");
    await finish(bobToken, "won");
    await finish(bobToken, "won");

    const res = await request(app).get("/api/v1/survival/scoreboard").set("token", aliceToken).expect(200);
    const entries = res.body.data.entries;

    expect(entries).toHaveLength(2);
    expect(entries[0].wins).toBe(2);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it("marks the row belonging to whoever asked", async () => {
    await finish(aliceToken, "won");
    await finish(bobToken, "lost");

    const mine = await request(app).get("/api/v1/survival/scoreboard").set("token", bobToken).expect(200);

    expect(mine.body.data.entries.filter((entry) => entry.you)).toHaveLength(1);
  });

  it("leaves out expeditions that used the cheat console", async () => {
    await finish(aliceToken, "won");
    await finish(bobToken, "won", true);

    const res = await request(app).get("/api/v1/survival/scoreboard").set("token", aliceToken).expect(200);

    expect(res.body.data.entries).toHaveLength(1);
  });

  it("carries nothing from another player beyond a name and two counts", async () => {
    await finish(bobToken, "won");

    const res = await request(app).get("/api/v1/survival/scoreboard").set("token", aliceToken).expect(200);

    expect(Object.keys(res.body.data.entries[0]).sort()).toEqual(["losses", "name", "rank", "wins", "you"]);
  });

  it("needs a session like everything else here", async () => {
    await request(app).get("/api/v1/survival/scoreboard").expect(401);
  });

  it("is not mistaken for an expedition id", async () => {
    // The route sits above /sessions/:sessionId, so "scoreboard" must not be
    // read as somebody's expedition.
    const res = await request(app).get("/api/v1/survival/scoreboard").set("token", aliceToken).expect(200);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
  });
});

describe("survival REST — WP-39 one player cannot see another", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("hides someone else's expedition behind a 404, not a 403", async () => {
    const start = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const id = start.body.data.session.id;

    await request(app)
      .get(BASE + "/" + id)
      .set("token", bobToken)
      .expect(404);
    await request(app)
      .patch(BASE + "/" + id)
      .set("token", bobToken)
      .send({ status: "won", result: FULL_RESULT })
      .expect(404);
  });

  it("lists only the caller's own history", async () => {
    await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    await request(app).post(BASE).set("token", bobToken).send({}).expect(201);

    const mine = await request(app).get(BASE).set("token", bobToken).expect(200);
    expect(mine.body.data.sessions).toHaveLength(1);
    expect(mine.body.data.sessions[0].userId).toBe("survival-bob");
  });
});

describe("survival REST — WP-43 one open expedition", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("abandons the previous run when a new one starts", async () => {
    const first = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);
    const second = await request(app).post(BASE).set("token", aliceToken).send({}).expect(201);

    expect(second.body.data.abandoned).toBe(1);

    const history = await request(app).get(BASE).set("token", aliceToken).expect(200);
    const open = history.body.data.sessions.filter((session) => session.status === "in_progress");

    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(second.body.data.session.id);
    expect(history.body.data.sessions.find((s) => s.id === first.body.data.session.id).status).toBe("abandoned");
  });
});
