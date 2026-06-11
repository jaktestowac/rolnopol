/**
 * Farm Defence — Achievements & Leaderboard repository.
 *
 * Thin persistence layer over the shared JSON "light database". Owns the shape
 * of the on‑disk store and all read/write access; the service contains the
 * counting logic and never touches the database directly.
 *
 * Store shape (data/fd-achievements.json):
 * {
 *   version: 1,
 *   players: {
 *     "<playerId>": {
 *       playerId, playerName,
 *       stats: { towersPlaced, enemiesKilled, ... },   // lifetime, server-counted
 *       achievements: { "<id>": "<unlockedAtISO>" },
 *       gamesPlayed, victories,
 *       bestScore, bestWave,
 *       createdAt, updatedAt
 *     }
 *   },
 *   updatedAt
 * }
 */
const dbManager = require("../../data/database-manager");

const DEFAULT_DATA = {
  version: 1,
  players: {},
  updatedAt: null,
};

function freshPlayer(playerId, playerName) {
  const now = new Date().toISOString();
  return {
    playerId,
    playerName: playerName || playerId,
    stats: {},
    achievements: {},
    gamesPlayed: 0,
    victories: 0,
    bestScore: 0,
    bestWave: 0,
    createdAt: now,
    updatedAt: now,
  };
}

class AchievementsRepository {
  constructor() {
    this.db = dbManager.getCustomDatabase("fd-achievements", "fd-achievements.json", DEFAULT_DATA);
    // Serialize writes: the shared JSON db does read-modify-write with an internal
    // await, so concurrent upserts would lose updates. Chaining them guarantees
    // each upsert sees the previous one's result.
    this._writeChain = Promise.resolve();
  }

  _enqueue(task) {
    const run = this._writeChain.then(task, task);
    // Keep the chain alive regardless of individual task outcome.
    this._writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async _readData() {
    const data = await this.db.getAll();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ...DEFAULT_DATA, players: {} };
    }
    return data;
  }

  /**
   * Get a single player's profile, or null if not seen yet.
   */
  async getPlayer(playerId) {
    const data = await this._readData();
    return (data.players && data.players[playerId]) || null;
  }

  /**
   * Atomically read‑modify‑write a single player profile.
   * The mutator receives a player object (created fresh if missing) and should
   * mutate it in place. Returns the persisted player.
   * @param {string} playerId
   * @param {(player: object) => void} mutator
   * @param {string} [playerName] applied only when the profile is first created
   */
  async upsertPlayer(playerId, mutator, playerName) {
    return this._enqueue(async () => {
      let result = null;
      await this.db.update((current) => {
        const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : { ...DEFAULT_DATA };
        next.players = { ...(next.players || {}) };

        const existing = next.players[playerId];
        const player = existing ? JSON.parse(JSON.stringify(existing)) : freshPlayer(playerId, playerName);

        mutator(player);
        player.updatedAt = new Date().toISOString();

        next.players[playerId] = player;
        next.updatedAt = new Date().toISOString();
        result = player;
        return next;
      });
      return result;
    });
  }

  /**
   * Return the top N leaderboard entries ranked by bestScore (desc), tie‑broken
   * by bestWave then earliest achievement. Only public, ranking‑relevant fields.
   */
  async getLeaderboard(limit = 20) {
    const data = await this._readData();
    const players = Object.values(data.players || {});
    return players
      .filter((p) => (p.gamesPlayed || 0) > 0)
      .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0) || (b.bestWave || 0) - (a.bestWave || 0))
      .slice(0, Math.max(0, limit))
      .map((p, idx) => ({
        rank: idx + 1,
        playerId: p.playerId,
        playerName: p.playerName,
        bestScore: p.bestScore || 0,
        bestWave: p.bestWave || 0,
        gamesPlayed: p.gamesPlayed || 0,
        victories: p.victories || 0,
      }));
  }
}

module.exports = new AchievementsRepository();
