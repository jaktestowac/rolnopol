/**
 * Farm Defence — Achievements & Leaderboard service.
 *
 * Listens to the authoritative Farm Defence event stream and derives milestone
 * progress, achievement unlocks and leaderboard scores entirely from the game
 * state the SERVER owns. The client only ever sends game *actions* — it can never
 * POST a score. The single client‑settable field is a cosmetic `playerName`.
 *
 * Anti‑cheat model:
 *   - Lifetime stats accumulate from positive deltas of the server's authoritative
 *     `state.stats`, so a "reset" (or any client tampering attempt with a fresh
 *     game) can only ever count what the server itself simulated.
 *   - The leaderboard score is computed by `computeScore` from that same state.
 *   - There is no API surface that accepts a score, kill count, or wave number.
 */
const { logError, logDebug } = require("../../helpers/logger-api");
const repository = require("./achievements-repository");
const { TRACKED_STATS, ACHIEVEMENTS, computeScore } = require("./achievements-config");

class AchievementsService {
  constructor() {
    // Per‑session in‑memory baseline of authoritative stats, used to compute
    // deltas without double counting and to detect game resets.
    // sessionId -> { stats: {<stat>: number}, gameEndCounted: boolean }
    this._baselines = new Map();
    this._attached = false;
  }

  /**
   * Subscribe to a Farm Defence service's event stream.
   */
  attach(fdService) {
    if (this._attached || !fdService || typeof fdService.onEvent !== "function") return;
    fdService.onEvent((event, ctx) => this._handleEvent(event, ctx));
    this._attached = true;
    logDebug("[FD/Achievements] Attached to Farm Defence event stream");
  }

  _baselineFor(sessionId) {
    if (!this._baselines.has(sessionId)) {
      this._baselines.set(sessionId, { stats: {}, gameEndCounted: false });
    }
    return this._baselines.get(sessionId);
  }

  /**
   * Handle a single authoritative game event. Synchronously computes deltas
   * (so ordering is safe even though persistence is async) and persists only
   * when something actually changed.
   */
  _handleEvent(event, ctx = {}) {
    const sessionId = ctx.sessionId;
    const state = ctx.state;
    if (!sessionId || !state || !state.stats) return;

    const type = event && event.type;
    if (type === "reset") {
      // New game for this session — start counting deltas from zero again.
      this._baselines.set(sessionId, { stats: {}, gameEndCounted: false });
      return;
    }

    const baseline = this._baselineFor(sessionId);

    // Compute positive deltas of tracked cumulative stats vs the last snapshot.
    const deltas = {};
    let hasDelta = false;
    for (const key of TRACKED_STATS) {
      const current = Number(state.stats[key] || 0);
      const prev = Number(baseline.stats[key] || 0);
      const delta = current - prev;
      if (delta > 0) {
        deltas[key] = delta;
        hasDelta = true;
      }
      baseline.stats[key] = current; // advance snapshot regardless (handles resets that lower values)
    }

    const isVictory = type === "victory";
    const isGameOver = type === "gameOver";
    const gameEnded = (isVictory || isGameOver) && !baseline.gameEndCounted;
    if (gameEnded) baseline.gameEndCounted = true;

    if (!hasDelta && !gameEnded) return;

    // Snapshot the score inputs now (state is mutated by the live game loop).
    const endScore = gameEnded ? computeScore(state.stats, isVictory) : 0;
    const endWave = gameEnded ? Number(state.wave?.current || state.stats.wavesCompleted || 0) : 0;

    this._persist(sessionId, { deltas, gameEnded, isVictory, endScore, endWave }).catch((err) =>
      logError("[FD/Achievements] Failed to persist progress:", err),
    );
  }

  async _persist(sessionId, { deltas, gameEnded, isVictory, endScore, endWave }) {
    await repository.upsertPlayer(sessionId, (player) => {
      player.stats = player.stats || {};
      for (const [key, delta] of Object.entries(deltas)) {
        player.stats[key] = (player.stats[key] || 0) + delta;
      }

      if (gameEnded) {
        player.gamesPlayed = (player.gamesPlayed || 0) + 1;
        if (isVictory) player.victories = (player.victories || 0) + 1;
        if (endScore > (player.bestScore || 0)) player.bestScore = endScore;
        if (endWave > (player.bestWave || 0)) player.bestWave = endWave;
      }

      this._evaluateAchievements(player);
    });
  }

  /**
   * Unlock any achievements whose threshold the player has now reached.
   * Mutates `player.achievements` in place.
   */
  _evaluateAchievements(player) {
    player.achievements = player.achievements || {};
    const now = new Date().toISOString();
    for (const def of ACHIEVEMENTS) {
      if (player.achievements[def.id]) continue;
      const value = this._statValue(player, def.stat);
      if (value >= def.threshold) {
        player.achievements[def.id] = now;
      }
    }
  }

  _statValue(player, stat) {
    if (stat === "victories") return player.victories || 0;
    if (stat === "gamesPlayed") return player.gamesPlayed || 0;
    return (player.stats && player.stats[stat]) || 0;
  }

  /**
   * Set a player's cosmetic display name. Does NOT affect score or ranking.
   */
  async setPlayerName(sessionId, name) {
    const clean = String(name || "").trim().slice(0, 32);
    if (!clean) throw new Error("setPlayerName requires a non-empty name");
    await repository.upsertPlayer(
      sessionId,
      (player) => {
        player.playerName = clean;
      },
      clean,
    );
    return { playerId: sessionId, playerName: clean };
  }

  /**
   * Build the achievements view for a player: the full catalogue annotated with
   * unlock status and current progress.
   */
  async getPlayerView(sessionId) {
    const player = await repository.getPlayer(sessionId);
    const stats = (player && player.stats) || {};
    const unlocked = (player && player.achievements) || {};

    const achievements = ACHIEVEMENTS.map((def) => {
      const value = player ? this._statValue(player, def.stat) : 0;
      return {
        id: def.id,
        label: def.label,
        description: def.description,
        icon: def.icon,
        threshold: def.threshold,
        progress: Math.min(value, def.threshold),
        unlocked: Boolean(unlocked[def.id]),
        unlockedAt: unlocked[def.id] || null,
      };
    });

    return {
      playerId: sessionId,
      playerName: (player && player.playerName) || sessionId,
      stats,
      gamesPlayed: (player && player.gamesPlayed) || 0,
      victories: (player && player.victories) || 0,
      bestScore: (player && player.bestScore) || 0,
      bestWave: (player && player.bestWave) || 0,
      achievements,
      unlockedCount: achievements.filter((a) => a.unlocked).length,
      totalCount: achievements.length,
    };
  }

  /**
   * Global leaderboard — top players by server‑computed best score.
   */
  async getLeaderboard(limit = 20) {
    return repository.getLeaderboard(limit);
  }
}

module.exports = new AchievementsService();
