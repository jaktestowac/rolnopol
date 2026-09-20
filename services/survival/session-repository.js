/**
 * Rolnopol Survival — expedition record store (PRD 9.2, WP-40).
 *
 * Thin persistence layer over the shared JSON "light database". Owns the shape
 * on disk and every read and write; the service holds the rules and never
 * touches the database directly.
 *
 * Store shape (data/survival-sessions.json):
 * {
 *   version: 2,
 *   sessions: [
 *     {
 *       id, userId, scenarioId, difficulty, seed, mapSource,
 *       status: "in_progress" | "won" | "lost" | "abandoned",
 *       startedAt, finishedAt,
 *       result: { days, hexesTravelled, health, water, food, eventsSeen, forcedMarches },
 *       moments: [{ day, key, kind }],   // the story, keys only (PRD 8.17)
 *       route: [q, r, q, r, ...],        // the path walked, flat (PRD 8.17)
 *       achievements: ["wayOut", ...],   // marks earned (PRD 8.18)
 *       snapshot: null            // a run parked mid-expedition, PRD 6.20
 *     }
 *   ],
 *   updatedAt
 * }
 *
 * `version` sits at the top so a later shape change is one migration function
 * reading a number instead of guesswork over fields. Version 2 is the first
 * time that promise was called in: it adds the chronicle fields and, while it
 * is there, fills in `cheatsUsed` and `challengeDate` on the records written
 * before those existed, which the quality-debt note in PRD 8.14 asked for. The map and the journal are
 * deliberately absent: the map replays from the seed, and the journal would grow
 * this file for no one's benefit (PRD 6.12).
 */
const path = require("path");
const dbManager = require("../../data/database-manager");
const JSONDatabase = require("../../data/json-database");

const DB_RESOURCE = "survival-sessions";
const DB_FILE = "survival-sessions.json";

const STORE_VERSION = 2;

const DEFAULT_DATA = {
  version: STORE_VERSION,
  sessions: [],
  updatedAt: null,
};

// Fields a record written by an older build never had. Spread underneath the
// record, so anything it does carry wins.
const RECORD_DEFAULTS = {
  challengeDate: null,
  cheatsUsed: false,
  mapSize: null,
  moments: [],
  route: [],
  achievements: [],
};

function migrateRecord(session) {
  return { ...RECORD_DEFAULTS, ...session };
}

/**
 * Bring a whole store up to the current shape.
 *
 * Runs on every read as well as once at startup: a read must never depend on
 * whether the migrating write has landed yet.
 */
function migrateStore(data) {
  return {
    ...data,
    version: STORE_VERSION,
    sessions: (Array.isArray(data.sessions) ? data.sessions : []).map(migrateRecord),
  };
}

class SurvivalSessionRepository {
  constructor() {
    // Tests point SURVIVAL_SESSIONS_DB_PATH at a throwaway file so a test run
    // never touches the repository's own data/ directory.
    const override = process.env.SURVIVAL_SESSIONS_DB_PATH;
    this.db = override
      ? new JSONDatabase(path.resolve(override), { ...DEFAULT_DATA, sessions: [] })
      : dbManager.getCustomDatabase(DB_RESOURCE, DB_FILE, { ...DEFAULT_DATA, sessions: [] });

    // Serialize writes. The shared JSON database does read-modify-write with an
    // await in the middle, so two concurrent updates would lose one of them.
    this._writeChain = Promise.resolve();

    // WP-40: the file exists from the first start, not from the first write.
    void this.db
      .ensureInitialized()
      .then(() => this._migrateOnDisk())
      .catch(() => {
        /* logged by the database itself */
      });
  }

  _enqueue(task) {
    const run = this._writeChain.then(task, task);
    this._writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async _readData() {
    const data = await this.db.getAll();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ...DEFAULT_DATA, sessions: [] };
    }
    return migrateStore({ ...DEFAULT_DATA, ...data });
  }

  /**
   * Write the migrated shape back once, at startup. Reads do not need this to
   * have happened; it is here so the file on disk stops being older than the
   * code every time somebody opens it.
   */
  async _migrateOnDisk() {
    return this._enqueue(async () => {
      await this.db.update((current) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) return { ...DEFAULT_DATA, sessions: [] };
        if (Number(current.version) === STORE_VERSION) return current;
        return { ...migrateStore(current), updatedAt: new Date().toISOString() };
      });
    });
  }

  /**
   * Every expedition of one player, newest first.
   * `limit` of 0 or undefined means all of them: the progress summary counts a
   * whole history, not the last page of it.
   */
  async listForUser(userId, limit) {
    const data = await this._readData();
    const mine = data.sessions.filter((session) => session.userId === userId);
    mine.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    return typeof limit === "number" && limit > 0 ? mine.slice(0, limit) : mine;
  }

  /**
   * One expedition, but only the caller's own. Somebody else's id looks exactly
   * like a missing one from here, which is what keeps the controller honest
   * about answering 404 rather than 403 (PRD 10.2).
   */
  async findForUser(userId, sessionId) {
    const data = await this._readData();
    return data.sessions.find((session) => session.id === sessionId && session.userId === userId) || null;
  }

  /**
   * Every finished expedition, for the scoreboard (PRD 8.11).
   *
   * The only read in this store that crosses users, and it returns just what a
   * league table needs: who, and how it ended. Nobody's seed, journal or saved
   * run leaves their own account.
   */
  async listFinished() {
    const data = await this._readData();

    return data.sessions
      .filter((session) => session.status === "won" || session.status === "lost")
      .map((session) => ({
        userId: session.userId,
        status: session.status,
        cheatsUsed: session.cheatsUsed === true,
        days: (session.result && session.result.days) || 0,
      }));
  }

  /**
   * One player's whole history, without the parked runs (PRD 8.18).
   *
   * A snapshot is a few kilobytes and the progress summary needs none of it, so
   * it is dropped here rather than carried through every tally.
   */
  async listRecordsForUser(userId) {
    const sessions = await this.listForUser(userId);
    return sessions.map((session) => {
      const { snapshot, ...rest } = session;
      return rest;
    });
  }

  async findOpenForUser(userId) {
    const data = await this._readData();
    return data.sessions.filter((session) => session.userId === userId && session.status === "in_progress");
  }

  async create(record) {
    return this._enqueue(async () => {
      await this.db.update((current) => {
        const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : { ...DEFAULT_DATA };
        next.version = next.version || DEFAULT_DATA.version;
        next.sessions = [...(Array.isArray(next.sessions) ? next.sessions : []), record];
        next.updatedAt = new Date().toISOString();
        return next;
      });
      return record;
    });
  }

  /**
   * Apply a patch to one of the caller's expeditions.
   * Returns the updated record, or null when it is not theirs or not there.
   */
  async patch(userId, sessionId, patch) {
    return this._enqueue(async () => {
      let updated = null;

      await this.db.update((current) => {
        const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : { ...DEFAULT_DATA };
        const sessions = Array.isArray(next.sessions) ? next.sessions : [];

        next.sessions = sessions.map((session) => {
          if (session.id !== sessionId || session.userId !== userId) return session;
          updated = { ...session, ...patch };
          return updated;
        });
        next.updatedAt = new Date().toISOString();
        return next;
      });

      return updated;
    });
  }

  /**
   * Close every open expedition of a player (PRD 6.12, WP-43). Starting a new
   * run is what triggers this, so a player never has two open records.
   */
  async closeOpenSessions(userId, status, finishedAt) {
    return this._enqueue(async () => {
      let closed = 0;

      await this.db.update((current) => {
        const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : { ...DEFAULT_DATA };
        const sessions = Array.isArray(next.sessions) ? next.sessions : [];

        next.sessions = sessions.map((session) => {
          if (session.userId !== userId || session.status !== "in_progress") return session;
          closed += 1;
          return { ...session, status, finishedAt };
        });
        next.updatedAt = new Date().toISOString();
        return next;
      });

      return closed;
    });
  }

  /** Test seam: drop everything this store holds. */
  async _resetForTests() {
    return this._enqueue(async () => {
      await this.db.replaceAll({ ...DEFAULT_DATA, sessions: [], updatedAt: new Date().toISOString() });
    });
  }
}

module.exports = new SurvivalSessionRepository();
module.exports.DEFAULT_DATA = DEFAULT_DATA;
module.exports.STORE_VERSION = STORE_VERSION;
module.exports.RECORD_DEFAULTS = RECORD_DEFAULTS;
module.exports.migrateStore = migrateStore;
module.exports.SurvivalSessionRepository = SurvivalSessionRepository;
