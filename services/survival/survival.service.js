/**
 * Rolnopol Survival — expedition rules on the server (PRD 10).
 *
 * The browser plays the game; this service only decides what may be written
 * down. It hands out seeds, keeps one open expedition per player, and refuses
 * results that could not have come from the game.
 *
 * On trust (PRD 10.4): the outcome is taken at the client's word. The game is
 * single-player with no ranking, so replaying a run server-side to verify it
 * would cost more than it is worth. What this service does guarantee is that
 * nothing outside the game's own ranges reaches the database, and that the seed
 * is recorded, which leaves the door open to verification later.
 */
const { randomUUID, randomInt } = require("crypto");
const repository = require("./session-repository");
const userDataInstance = require("../../data/user-data-singleton").getInstance();
const gameConfig = require("../../public/js/games/survival/config.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const achievements = require("../../public/js/games/survival/achievements.js");

const MAX_SEED = 2147483646;
// A saved run is a few kilobytes (the map is not in it, only what the player
// changed). The cap is generous enough for a long expedition and small enough
// that the JSON database, which holds every record in memory, stays sane.
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const DAILY_SCENARIO = "lost";
const DAILY_DIFFICULTY = "normal";
const DAILY_MAP_SIZE = "standard";
const CLOSED_STATUSES = ["won", "lost", "abandoned"];
const DEFAULT_SCENARIO = "lost";
const HISTORY_LIMIT = 20;
const SCOREBOARD_LIMIT = 10;

// How much of the chronicle a record may carry (PRD 8.17). Both caps are here
// so one expedition cannot grow the store without bound: eight moments is what
// the end screen shows, and 3000 numbers is 1500 steps, several times the
// longest expedition the balance bot has ever walked.
const MAX_MOMENTS = 8;
const MAX_ROUTE_LENGTH = 3000;
const MOMENT_KINDS = ["good", "harm", "event"];

// Result fields and the range each one may occupy. The resource ranges come
// from the game's own config, so a balance change cannot leave the validator
// behind.
const RESULT_FIELDS = {
  days: { min: 1, max: 100000 },
  hexesTravelled: { min: 0, max: 100000 },
  health: { min: gameConfig.RESOURCES.health.min, max: gameConfig.RESOURCES.health.max },
  water: { min: gameConfig.RESOURCES.water.min, max: gameConfig.RESOURCES.water.max },
  food: { min: gameConfig.RESOURCES.food.min, max: gameConfig.RESOURCES.food.max },
  eventsSeen: { min: 0, max: 100000 },
  forcedMarches: { min: 0, max: 100000 },
};

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function generateSeed() {
  return randomInt(1, MAX_SEED);
}

/**
 * A seed the player supplied. Accepted so a known map can be replayed (PRD
 * 10.3); rejected when it is not a positive integer, because the generator
 * treats anything else as a string and the record would stop being replayable.
 */
function normalizeSeed(value) {
  if (value === undefined || value === null || value === "") return generateSeed();

  const seed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(seed) || seed < 1 || seed > MAX_SEED) {
    throw fail(400, "seed must be an integer between 1 and " + MAX_SEED);
  }
  return seed;
}

/** Today, as the challenge counts it. UTC, so the map turns over once a day. */
function challengeDateFor(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

/**
 * The seed everybody gets today (WP-67).
 * A hash of the date, so two players who start on the same day walk the same
 * map without the server keeping a table of anything.
 */
function dailySeedFor(date) {
  let hash = 2166136261;
  for (let i = 0; i < date.length; i += 1) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % MAX_SEED) + 1;
}

function normalizeScenario(value) {
  const scenarioId = value || DEFAULT_SCENARIO;
  if (!scenarios.getScenario(scenarioId)) {
    throw fail(400, "Unknown scenario: " + scenarioId);
  }
  return scenarioId;
}

/**
 * The story, as a record may keep it (PRD 8.17).
 *
 * Dictionary keys, not sentences: journal text belongs to the string table in
 * the browser, and storing it here would freeze one build of the wording into
 * the database. Anything malformed is dropped rather than refused, because a
 * broken chronicle is not a reason to lose a result.
 */
function sanitizeMoments(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((moment) => moment && typeof moment === "object" && typeof moment.key === "string")
    .slice(0, MAX_MOMENTS)
    .map((moment) => ({
      day: Math.max(1, Math.trunc(Number(moment.day) || 1)),
      key: moment.key.slice(0, 80),
      kind: MOMENT_KINDS.includes(moment.kind) ? moment.kind : "event",
    }));
}

/** The path walked, as flat coordinate pairs. An odd tail is cut, not guessed. */
function sanitizeRoute(raw) {
  if (!Array.isArray(raw)) return [];

  const numbers = raw.slice(0, MAX_ROUTE_LENGTH).filter((value) => Number.isFinite(Number(value)));
  const even = numbers.length - (numbers.length % 2);
  return numbers.slice(0, even).map((value) => Math.trunc(Number(value)));
}

/** How much of this history counts towards unlocking a scenario (PRD 8.18). */
function talliesFrom(sessions) {
  let finished = 0;
  let wins = 0;

  for (const session of sessions) {
    if (session.cheatsUsed) continue;
    if (session.status !== "won" && session.status !== "lost") continue;

    finished += 1;
    if (session.status === "won") wins += 1;
  }

  return { finished, wins };
}

/** Days as the daily challenge counts them, for streak arithmetic. */
function dayNumber(date) {
  return Math.floor(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000);
}

/**
 * The daily-challenge streak (PRD 8.18).
 *
 * Only expeditions played to an end count: opening the map of the day and
 * walking away from it is not a day of the challenge. A streak stays current
 * while yesterday is still in it, so somebody who has not played yet today has
 * something to keep rather than something already lost.
 */
function dailyStreak(sessions, today) {
  const played = new Set(
    sessions
      .filter((session) => typeof session.challengeDate === "string" && (session.status === "won" || session.status === "lost"))
      .map((session) => session.challengeDate),
  );

  const sorted = [...played].sort();
  if (sorted.length === 0) return { current: 0, longest: 0, lastDate: null, playedToday: false };

  const days = sorted.map(dayNumber);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const owned = new Set(days);
  const now = dayNumber(today || challengeDateFor());
  let cursor = owned.has(now) ? now : owned.has(now - 1) ? now - 1 : null;
  let current = 0;
  while (cursor !== null && owned.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  return { current, longest, lastDate: sorted[sorted.length - 1], playedToday: owned.has(now) };
}

/**
 * Personal bests, one row per scenario and map size (PRD 8.18).
 *
 * The pairing is deliberate. PRD 6.21 measured map size as the real difficulty
 * dial, so a fast escape from a 24 by 24 map and one from a 128 by 128 map are
 * not the same feat and do not belong in the same row.
 */
function personalRecords(sessions) {
  const rows = new Map();

  for (const session of sessions) {
    if (session.cheatsUsed) continue;
    if (session.status !== "won" && session.status !== "lost") continue;

    const mapSize = session.mapSize || gameConfig.DEFAULT_MAP_SIZE;
    const key = session.scenarioId + ":" + mapSize;
    const days = (session.result && session.result.days) || 0;
    const hexes = (session.result && session.result.hexesTravelled) || 0;

    const row = rows.get(key) || {
      scenarioId: session.scenarioId,
      mapSize,
      attempts: 0,
      wins: 0,
      bestDays: null,
      longestSurvived: 0,
      bestHexes: 0,
    };

    row.attempts += 1;
    if (session.status === "won") {
      row.wins += 1;
      if (row.bestDays === null || days < row.bestDays) row.bestDays = days;
    }
    if (days > row.longestSurvived) row.longestSurvived = days;
    if (hexes > row.bestHexes) row.bestHexes = hexes;

    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.attempts - a.attempts || a.scenarioId.localeCompare(b.scenarioId));
}

/**
 * The map size the player picked (PRD 8.9).
 * It goes on the record because the seed on its own no longer says how big the
 * map was, and a replayed seed has to give back the same map.
 */
function normalizeMapSize(value) {
  const mapSize = value || gameConfig.DEFAULT_MAP_SIZE;
  if (!gameConfig.MAP_SIZES[mapSize]) {
    throw fail(400, "Unknown map size: " + mapSize);
  }
  return mapSize;
}

function normalizeDifficulty(value) {
  const difficulty = value || gameConfig.DEFAULT_DIFFICULTY;
  if (!gameConfig.DIFFICULTIES[difficulty]) {
    throw fail(400, "Unknown difficulty: " + difficulty);
  }
  return difficulty;
}

function mapSourceOf(scenarioId) {
  const scenario = scenarios.getScenario(scenarioId);
  const source = (scenario.map && scenario.map.source) || "generated";
  return source === "handmade" ? "handmade:" + scenario.map.id : "generated";
}

/**
 * Keep the known fields, drop everything else, clamp what is left.
 * A payload with no usable numbers at all is a bug on the client, not an empty
 * expedition, so it is refused.
 */
function sanitizeResult(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw fail(400, "result must be an object");
  }

  const result = {};
  let seen = 0;

  for (const field of Object.keys(RESULT_FIELDS)) {
    const range = RESULT_FIELDS[field];
    const value = raw[field];

    if (value === undefined || value === null) {
      result[field] = range.min;
      continue;
    }

    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw fail(400, "result." + field + " must be a number");
    }

    result[field] = Math.min(range.max, Math.max(range.min, Math.trunc(numeric)));
    seen += 1;
  }

  if (seen === 0) throw fail(400, "result carries no known fields");
  return result;
}

function normalizeStatus(value) {
  if (!CLOSED_STATUSES.includes(value)) {
    throw fail(400, "status must be one of: " + CLOSED_STATUSES.join(", "));
  }
  return value;
}

/**
 * Open a new expedition (WP-41, WP-43).
 * Any run the player left open is marked abandoned first, so the store holds at
 * most one `in_progress` record per player.
 */
async function startSession(input) {
  const userId = input.userId;
  if (!userId) throw fail(401, "Access token required");

  // The daily challenge fixes all three, otherwise there is nothing to compare.
  const daily = input.daily === true;
  const challengeDate = daily ? challengeDateFor() : null;

  const scenarioId = daily ? DAILY_SCENARIO : normalizeScenario(input.scenarioId);
  const difficulty = daily ? DAILY_DIFFICULTY : normalizeDifficulty(input.difficulty);
  const mapSize = daily ? DAILY_MAP_SIZE : normalizeMapSize(input.mapSize);
  const seed = daily ? dailySeedFor(challengeDate) : normalizeSeed(input.seed);
  const now = new Date().toISOString();

  // Every expedition is open, so starting one reads no history (PRD 6.31).
  // If a rung is ever put back in `scenarios.UNLOCKS`, the guard belongs here
  // and answers 409, not 403: the browser reads 403 as a dead session and would
  // send the player to the login page rather than explain anything (WP-38).
  if (!scenarios.isUnlocked(scenarioId, { finished: 0, wins: 0 })) {
    throw fail(409, "Scenario is not unlocked yet: " + scenarioId);
  }

  // Abandoning keeps whatever mark the run already had: closeOpenSessions only
  // touches status and finishedAt.
  const abandoned = await repository.closeOpenSessions(userId, "abandoned", now);

  const record = {
    id: randomUUID(),
    userId,
    scenarioId,
    difficulty,
    mapSize,
    seed,
    mapSource: mapSourceOf(scenarioId),
    status: "in_progress",
    startedAt: now,
    finishedAt: null,
    result: null,
    snapshot: null,
    challengeDate,
    cheatsUsed: false,
  };

  await repository.create(record);
  return { session: record, abandoned };
}

/** Close an expedition (WP-42). Wins and losses take the same path. */
async function closeSession(input) {
  const userId = input.userId;
  if (!userId) throw fail(401, "Access token required");

  const status = normalizeStatus(input.status);
  const result = sanitizeResult(input.result);

  const existing = await repository.findForUser(userId, input.sessionId);
  if (!existing) throw fail(404, "Expedition not found");
  if (existing.status !== "in_progress") throw fail(409, "Expedition is already closed");

  // A run that used the cheat console says so, next to its result (PRD 8.8).
  // Sticky: a run that was marked earlier cannot be scrubbed clean by closing
  // it without the flag.
  const cheatsUsed = existing.cheatsUsed === true || input.cheatsUsed === true || input.result?.cheatsUsed === true;

  // A cheated run keeps its result and earns nothing, the same rule the
  // scoreboard follows (PRD 6.24).
  const earned = cheatsUsed ? [] : achievements.sanitize(input.achievements);

  const updated = await repository.patch(userId, input.sessionId, {
    status,
    result,
    cheatsUsed,
    moments: sanitizeMoments(input.moments),
    route: sanitizeRoute(input.route),
    achievements: earned,
    finishedAt: new Date().toISOString(),
  });

  return updated;
}

/**
 * Save a run in progress (WP-69).
 * Only an open expedition can be saved: a finished one is a record, not a game.
 */
async function saveSnapshot(input) {
  const userId = input.userId;
  if (!userId) throw fail(401, "Access token required");

  const snapshot = input.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw fail(400, "snapshot must be an object");
  }
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) {
    throw fail(413, "snapshot is too large");
  }

  const existing = await repository.findForUser(userId, input.sessionId);
  if (!existing) throw fail(404, "Expedition not found");
  if (existing.status !== "in_progress") throw fail(409, "Expedition is already closed");

  // The saved run carries the cheat mark, so the record picks it up here rather
  // than waiting for the expedition to be closed (PRD 6.20). A run that is
  // cheated and then abandoned, or simply left open, is marked all the same.
  const cheatsUsed = existing.cheatsUsed === true || snapshot.cheatsUsed === true;

  return repository.patch(userId, input.sessionId, { snapshot, cheatsUsed });
}

/**
 * The caller's history. Saved runs are reported by a flag rather than shipped
 * whole: the list would otherwise carry a few kilobytes per row for something
 * only one of them ever needs.
 */
async function listSessions(userId, limit) {
  if (!userId) throw fail(401, "Access token required");
  const sessions = await repository.listForUser(userId, limit || HISTORY_LIMIT);

  return sessions.map((session) => {
    const { snapshot, ...rest } = session;
    return { ...rest, hasSnapshot: !!snapshot };
  });
}

/**
 * The scoreboard (PRD 8.11).
 *
 * Two decisions worth stating, because this is the first thing in the game that
 * shows one player something about another.
 *
 * Cheated expeditions are left out entirely, wins and losses alike. The server
 * takes results on trust (PRD 10.4), which is a fair trade for a single-player
 * run and a poor one for a league table; the cheat mark is what keeps the two
 * apart.
 *
 * What crosses between players is a name and two counts. Seeds, journals and
 * saved runs stay where they were.
 */
async function getScoreboard(userId, limit) {
  if (!userId) throw fail(401, "Access token required");

  const finished = await repository.listFinished();
  const tally = new Map();

  for (const row of finished) {
    if (row.cheatsUsed) continue;

    const entry = tally.get(row.userId) || { userId: row.userId, wins: 0, losses: 0 };
    if (row.status === "won") entry.wins += 1;
    else entry.losses += 1;
    tally.set(row.userId, entry);
  }

  const users = await userDataInstance.getUsers();
  const namesById = new Map(users.map((user) => [String(user.id), user.displayedName || user.username]));

  return [...tally.values()]
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || String(a.userId).localeCompare(String(b.userId)))
    .slice(0, limit || SCOREBOARD_LIMIT)
    .map((entry, index) => ({
      rank: index + 1,
      name: namesById.get(String(entry.userId)) || "Unknown",
      wins: entry.wins,
      losses: entry.losses,
      // So the page can mark the row that belongs to whoever is looking.
      you: String(entry.userId) === String(userId),
    }));
}

/**
 * Everything a player has to come back for (PRD 8.18, faza D).
 *
 * One call rather than four, because the menu needs all of it at once and all
 * four answers come out of the same read.
 */
async function getProgress(userId, today) {
  if (!userId) throw fail(401, "Access token required");

  const sessions = await repository.listRecordsForUser(userId);
  const tallies = talliesFrom(sessions);

  const earned = new Set();
  for (const session of sessions) {
    if (session.cheatsUsed) continue;
    for (const id of session.achievements || []) {
      if (achievements.isKnown(id)) earned.add(id);
    }
  }

  const unlocked = scenarios.unlockedScenarios(tallies);

  return {
    totals: { ...tallies, expeditions: sessions.length },
    records: personalRecords(sessions),
    streak: dailyStreak(sessions, today),
    achievements: achievements.ids().map((id) => ({ id, earned: earned.has(id) })),
    scenarios: scenarios.listScenarios().map((id) => ({
      id,
      unlocked: unlocked.includes(id),
      requires: scenarios.requirementFor(id),
    })),
  };
}

async function getSession(userId, sessionId) {
  if (!userId) throw fail(401, "Access token required");
  const session = await repository.findForUser(userId, sessionId);
  if (!session) throw fail(404, "Expedition not found");
  return session;
}

module.exports = {
  startSession,
  closeSession,
  saveSnapshot,
  getScoreboard,
  getProgress,
  personalRecords,
  dailyStreak,
  talliesFrom,
  sanitizeMoments,
  sanitizeRoute,
  dailySeedFor,
  challengeDateFor,
  listSessions,
  getSession,
  sanitizeResult,
  normalizeSeed,
  normalizeScenario,
  normalizeDifficulty,
  normalizeMapSize,
  generateSeed,
  CLOSED_STATUSES,
  HISTORY_LIMIT,
  SCOREBOARD_LIMIT,
  MAX_SEED,
  MAX_SNAPSHOT_BYTES,
  MAX_MOMENTS,
  MAX_ROUTE_LENGTH,
};
