const { logDebug, logInfo } = require("../helpers/logger-api");
const { towerRegistry } = require("./fd/tower-registry");
const { enemyRegistry } = require("./fd/enemy-registry");
const { effectRegistry } = require("./fd/effect-registry");
const { WaveGenerator, DIFFICULTY_PRESETS, GAME_MODES } = require("./fd/wave-generator");
const { MapGenerator } = require("./fd/map-generator");
const { TickEngine } = require("./fd/tick-engine");
const { DEFAULT_THEMES } = require("./fd/themes");

const DEFAULT_SESSION_ID = "default";
const MAX_EVENTS = 60;

const DEFAULT_SIZE_PRESETS = {
  tiny: { width: 11, height: 11, startGold: 150, startLives: 15, totalWaves: 5 },
  small: { width: 15, height: 15, startGold: 200, startLives: 20, totalWaves: 8 },
  medium: { width: 21, height: 21, startGold: 250, startLives: 20, totalWaves: 10 },
  big: { width: 31, height: 31, startGold: 300, startLives: 25, totalWaves: 15 },
};

const DEFAULT_DIFFICULTY = "normal";
const DEFAULT_GAME_MODE = "classic";

const ACTION_ALIASES = {
  build: "placeTower",
  sell: "sellTower",
  upgrade: "upgradeTower",
  next: "startWave",
  step: "tick",
};

/**
 * Farm Defence Service — singleton orchestrator.
 * Owns sessions, actions, and snapshot building.
 * Delegates all game logic to the modular engine (registries + tick engine).
 */
class FarmDefenceService {
  constructor() {
    // Registries (extensible from outside)
    this.towerRegistry = towerRegistry;
    this.enemyRegistry = enemyRegistry;
    this.effectRegistry = effectRegistry;
    this.waveGenerator = new WaveGenerator();
    this.mapGenerator = new MapGenerator();
    this.tickEngine = new TickEngine();
    this.themes = { ...DEFAULT_THEMES };
    this.sizePresets = { ...DEFAULT_SIZE_PRESETS };
    this.difficultyPresets = { ...DIFFICULTY_PRESETS };
    this.gameModes = { ...GAME_MODES };

    // Session management (same as labyrinth)
    this.sessions = new Map();
    this.state = null;
    this.revision = 0;
    this.events = [];

    // Action handler registry
    this.actionHandlers = new Map();
    this.registerBuiltInActions();
  }

  // ── Session isolation (identical to labyrinth pattern) ──────────────

  _getSessionKey(sessionId = DEFAULT_SESSION_ID) {
    return sessionId || DEFAULT_SESSION_ID;
  }

  _getSessionContext(sessionId = DEFAULT_SESSION_ID) {
    const key = this._getSessionKey(sessionId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        state: this._createFreshState({ size: "medium", seed: "rolnopol-fd" }),
        revision: 0,
        events: [],
      });
    }
    return this.sessions.get(key);
  }

  _withSession(sessionId, callback) {
    const key = this._getSessionKey(sessionId);
    const context = this._getSessionContext(key);

    const previous = {
      state: this.state,
      revision: this.revision,
      events: this.events,
    };

    this.state = context.state;
    this.revision = context.revision;
    this.events = context.events;

    try {
      return callback(key, context);
    } finally {
      context.state = this.state;
      context.revision = this.revision;
      context.events = this.events;
      this.state = previous.state;
      this.revision = previous.revision;
      this.events = previous.events;
    }
  }

  // ── Action handler registry ────────────────────────────────────────

  registerActionHandler(name, handler) {
    this.actionHandlers.set(name, handler);
  }

  registerBuiltInActions() {
    this.registerActionHandler("placetower", (p, o) => this._placeTower(p, o));
    this.registerActionHandler("selltower", (p, o) => this._sellTower(p, o));
    this.registerActionHandler("upgradetower", (p, o) => this._upgradeTower(p, o));
    this.registerActionHandler("startwave", (p, o) => this._startWave(p, o));
    this.registerActionHandler("tick", (p, o) => this._gameTick(p, o));
    this.registerActionHandler("settheme", (p, o) => this._setTheme(p, o));
    this.registerActionHandler("reset", (p, o) => this.resetFarmDefence(p, o));
    this.registerActionHandler("configure", (p, o) => this._configure(p, o));
  }

  _resolveActionName(rawAction) {
    const lower = String(rawAction).toLowerCase();
    return ACTION_ALIASES[lower] || rawAction;
  }

  applyAction(rawAction, payload = {}, options = {}) {
    const resolved = this._resolveActionName(rawAction);
    const normalized = resolved.toLowerCase();
    const handler = this.actionHandlers.get(normalized);
    if (!handler) throw new Error(`Unknown farm defence action: ${rawAction}`);

    return this._withSession(options.sessionId, () => {
      const beforeRevision = this.revision;
      handler(payload, { ...options, sessionId: options.sessionId });
      const changed = this.revision > beforeRevision;
      const snapshot = this._buildSnapshot({ ...options, sessionId: options.sessionId });
      const event = this.events[this.events.length - 1] || null;
      return { action: resolved, snapshot, event, message: event?.message || null, changed };
    });
  }

  // ── Game actions ───────────────────────────────────────────────────

  _placeTower({ x, y, type } = {}) {
    if (x === undefined || y === undefined || !type) {
      throw new Error("placeTower requires { x, y, type }");
    }
    const def = this.towerRegistry.get(type);
    if (!def) throw new Error(`Unknown tower type: ${type}`);
    if (this.state.resources.gold < def.cost) throw new Error("Not enough gold");
    if (this.state.map.cells[y] && this.state.map.cells[y][x] !== "buildable") {
      throw new Error("Cannot build here — cell is not buildable");
    }
    if (this._towerAt(x, y)) throw new Error("Tower already placed here");

    this.state.resources.gold -= def.cost;
    this.state.towers.push({
      id: `tower-${++this.state._counters.towerId}`,
      x,
      y,
      type,
      cooldown: 0,
    });
    this.state.stats.towersPlaced++;
    this._incrementRevision("towerPlaced", { x, y, type, cost: def.cost });
  }

  _sellTower({ towerId } = {}) {
    if (!towerId) throw new Error("sellTower requires { towerId }");
    const idx = this.state.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) throw new Error(`Tower not found: ${towerId}`);
    const tower = this.state.towers[idx];
    const def = this.towerRegistry.get(tower.type);
    const refund = Math.floor((def ? def.cost : 50) * 0.6);
    this.state.resources.gold += refund;
    this.state.towers.splice(idx, 1);
    this._incrementRevision("towerSold", { towerId, refund });
  }

  _upgradeTower({ towerId } = {}) {
    if (!towerId) throw new Error("upgradeTower requires { towerId }");
    const tower = this.state.towers.find((t) => t.id === towerId);
    if (!tower) throw new Error(`Tower not found: ${towerId}`);
    const def = this.towerRegistry.get(tower.type);
    if (!def) throw new Error(`Unknown tower type: ${tower.type}`);

    const currentLevel = tower.level || 1;
    // Each upgrade costs more: base 60% of tower cost, multiplied by level
    // Level 1→2: 60%, Level 2→3: 90%, Level 3→4: 120%, Level 4→5: 150%, etc.
    const upgradeCost = Math.floor(def.cost * 0.6 * currentLevel);
    if (this.state.resources.gold < upgradeCost) throw new Error("Not enough gold to upgrade");

    this.state.resources.gold -= upgradeCost;
    tower.level = currentLevel + 1;
    this._incrementRevision("towerUpgraded", { towerId, level: tower.level, cost: upgradeCost });
  }

  _startWave() {
    if (this.state.wave.status === "active") throw new Error("Wave already active");
    if (this.state.stats.gameOver) throw new Error("Game is over");

    const gameMode = this.state.gameMode || DEFAULT_GAME_MODE;
    const modeConfig = this.gameModes[gameMode] || GAME_MODES.classic;

    // In endless mode, never declare victory — just keep going
    if (this.state.stats.victory && !modeConfig.infinite) throw new Error("Game is over");

    const nextWave = this.state.wave.status === "complete" ? this.state.wave.current + 1 : this.state.wave.current;

    const rng = this._createRng(this.state.map.seed + "-wave-" + nextWave);
    const difficulty = this.state.difficulty || DEFAULT_DIFFICULTY;
    const queue = this.waveGenerator.generate(nextWave, this.state.wave.total, {
      strategy: gameMode,
      difficulty,
      rng,
    });

    // Apply difficulty speed multiplier to enemies
    const diffPreset = this.difficultyPresets[difficulty] || DIFFICULTY_PRESETS.normal;
    const speedMult = diffPreset.speedMultiplier;

    // Store difficulty preset in state for tick engine access
    this.state._difficultyPreset = diffPreset;

    this.state.wave.current = nextWave;
    this.state.wave.status = "active";
    this.state.wave.enemiesSpawned = 0;
    this.state.wave.enemiesTotal = queue.length;
    this.state.wave.queue = queue;
    this.state.wave.spawnTimer = modeConfig.spawnGap || 0;
    this.state.wave.speedMultiplier = speedMult;

    // Rush mode: bonus gold per wave start
    if (modeConfig.goldMultiplier) {
      const bonus = Math.floor(nextWave * 5 * modeConfig.goldMultiplier);
      this.state.resources.gold += bonus;
    }

    this._incrementRevision("waveStarted", { wave: nextWave, enemyCount: queue.length, difficulty, gameMode });
  }

  _gameTick() {
    if (this.state.wave.status !== "active") return;
    if (this.state.stats.gameOver || this.state.stats.victory) return;
    if (this.state.enemies.length === 0 && this.state.wave.enemiesSpawned >= this.state.wave.enemiesTotal) return;

    this.tickEngine.run(this.state, {
      towerRegistry: this.towerRegistry,
      enemyRegistry: this.enemyRegistry,
      effectRegistry: this.effectRegistry,
    });

    this._incrementRevision("tick");
  }

  _setTheme({ theme } = {}) {
    if (!theme || !this.themes[theme]) {
      throw new Error(`Unknown theme: ${theme}. Available: ${Object.keys(this.themes).join(", ")}`);
    }
    this.state.theme = theme;
    this._incrementRevision("themeChanged", { theme });
  }

  _configure(payload = {}) {
    if (payload.fogRadius !== undefined) {
      this.state.fog.radius = payload.fogRadius;
    }
    this._incrementRevision("configured", payload);
  }

  // ── Reset ──────────────────────────────────────────────────────────

  resetFarmDefence(payload = {}, options = {}) {
    const size = payload.size || "medium";
    const seed = payload.seed || "rolnopol-fd";
    const difficulty = payload.difficulty || DEFAULT_DIFFICULTY;
    const gameMode = payload.gameMode || DEFAULT_GAME_MODE;
    const config = this.sizePresets[size] || this.sizePresets.medium;

    const freshState = this._createFreshState({ size, seed, difficulty, gameMode, ...config, ...payload });

    // Update both global state and default session
    this.state = freshState;
    this.revision = 0;
    this.events = [];
    this.sessions.set(DEFAULT_SESSION_ID, {
      state: freshState,
      revision: 0,
      events: [],
    });

    if (options.logCreation !== false) {
      logInfo(`[FarmDefenceService] Reset: ${size} (${this.state.map.width}x${this.state.map.height}), seed: ${seed}`);
    }
    this._incrementRevision("reset", { size, seed });
  }

  // ── State creation ─────────────────────────────────────────────────

  _createFreshState({
    size = "medium",
    seed = "rolnopol-fd",
    width,
    height,
    startGold,
    startLives,
    totalWaves,
    difficulty = DEFAULT_DIFFICULTY,
    gameMode = DEFAULT_GAME_MODE,
  } = {}) {
    const config = this.sizePresets[size] || this.sizePresets.medium;
    const w = width || config.width;
    const h = height || config.height;

    const map = this.mapGenerator.generate(w, h, seed);
    map.width = w;
    map.height = h;
    map.seed = seed;

    // Apply difficulty modifiers
    const diffPreset = this.difficultyPresets[difficulty] || DIFFICULTY_PRESETS.normal;
    const modeConfig = this.gameModes[gameMode] || GAME_MODES.classic;

    const finalStartGold = Math.max(
      50,
      Math.floor((startGold || config.startGold) * diffPreset.goldMultiplier) + diffPreset.startGoldBonus,
    );
    const finalStartLives = Math.max(5, (startLives || config.startLives) + diffPreset.livesBonus);
    const finalTotalWaves = modeConfig.infinite ? 9999 : totalWaves || config.totalWaves;

    return {
      id: `fd-${w}x${h}-${seed}`,
      theme: "obsidian",
      difficulty,
      gameMode,
      fog: { enabled: false, radius: 3 },
      map,
      towers: [],
      enemies: [],
      projectiles: [],
      _difficultyPreset: diffPreset,
      wave: {
        current: 1,
        total: finalTotalWaves,
        status: "preparing",
        enemiesSpawned: 0,
        enemiesTotal: 0,
        spawnTimer: 0,
        queue: [],
        speedMultiplier: diffPreset.speedMultiplier,
      },
      resources: {
        gold: finalStartGold,
        lives: finalStartLives,
        score: 0,
      },
      stats: {
        towersPlaced: 0,
        enemiesKilled: 0,
        enemiesLeaked: 0,
        wavesCompleted: 0,
        totalDamageDealt: 0,
        gameOver: false,
        victory: false,
      },
      _counters: {
        towerId: 0,
        enemyId: 0,
        projId: 0,
      },
    };
  }

  // ── Revision & events ──────────────────────────────────────────────

  _incrementRevision(type, details = {}) {
    this.revision++;
    const event = {
      revision: this.revision,
      type,
      details,
      occurredAt: new Date().toISOString(),
    };

    if (type === "towerPlaced") event.message = `Tower placed at (${details.x}, ${details.y})`;
    else if (type === "towerSold") event.message = `Tower sold (refund: ${details.refund}g)`;
    else if (type === "towerUpgraded") event.message = `Tower upgraded to level ${details.level}`;
    else if (type === "waveStarted") event.message = `Wave ${details.wave} started (${details.enemyCount} enemies)`;
    else if (type === "waveComplete") event.message = `Wave complete!`;
    else if (type === "gameOver") event.message = "Game over — all lives lost!";
    else if (type === "victory") event.message = "Victory — all waves cleared!";
    else if (type === "themeChanged") event.message = `Theme changed to ${details.theme}`;
    else if (type === "reset") event.message = `Game reset (${details.size}, seed: ${details.seed})`;

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    // Check for game-over / victory events from tick
    if (this.state) {
      if (this.state.stats.gameOver && type === "tick") {
        this._incrementRevision("gameOver");
      }
      if (this.state.stats.victory && type === "tick") {
        this._incrementRevision("victory");
      }
    }
  }

  // ── Snapshot ───────────────────────────────────────────────────────

  getSnapshot(options = {}) {
    return this._withSession(options.sessionId, () => {
      return this._buildSnapshot(options);
    });
  }

  getUpdates(sinceRevision, options = {}) {
    return this._withSession(options.sessionId, () => {
      const snapshot = this._buildSnapshot(options);
      const eventsSince = this.events.filter((e) => e.revision > sinceRevision);
      const changed = eventsSince.length > 0;
      return {
        changed,
        revision: this.revision,
        snapshot: changed ? snapshot : null,
        events: eventsSince,
        message: changed ? "Updates available" : "No changes",
      };
    });
  }

  _buildSnapshot(options = {}) {
    if (!this.state) return null;

    const { viewportSize, compact = true } = options;
    const theme = this.themes[this.state.theme] || this.themes.obsidian;

    // Build grid (full map or viewport)
    const grid = this._buildGrid(viewportSize, compact);

    const snapshot = {
      id: this.state.id,
      revision: this.revision,
      updatedAt: new Date().toISOString(),
      theme: this.state.theme,
      difficulty: this.state.difficulty || DEFAULT_DIFFICULTY,
      gameMode: this.state.gameMode || DEFAULT_GAME_MODE,
      map: {
        width: this.state.map.width,
        height: this.state.map.height,
        seed: this.state.map.seed,
        spawn: this.state.map.spawn,
        exit: this.state.map.exit,
      },
      grid,
      towers: this.state.towers.map((t) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        type: t.type,
        level: t.level || 1,
        cooldown: t.cooldown,
      })),
      enemies: this.state.enemies.map((e) => ({
        id: e.id,
        type: e.type,
        hp: e.hp,
        maxHp: e.maxHp,
        pathIndex: e.pathIndex,
        speed: e.speed,
      })),
      wave: { ...this.state.wave, queue: undefined }, // Don't expose queue to client
      nextWave: this.getNextWavePreview(options), // Preview for upcoming wave
      resources: { ...this.state.resources },
      stats: { ...this.state.stats },
      capabilities: this._buildCapabilities(),
    };

    if (viewportSize) {
      snapshot.viewport = this._getViewportWindow(viewportSize);
    }

    return snapshot;
  }

  _buildGrid(viewportSize, compact) {
    const { cells, path } = this.state.map;
    const width = cells[0] ? cells[0].length : 0;
    const height = cells.length;

    const startX = 0;
    const startY = 0;
    const endX = viewportSize ? Math.min(viewportSize, width) : width;
    const endY = viewportSize ? Math.min(viewportSize, height) : height;

    // Build lookup maps for towers and enemies
    const towerMap = new Map();
    for (const t of this.state.towers) {
      towerMap.set(`${t.x},${t.y}`, t);
    }

    const enemyMap = new Map();
    for (const e of this.state.enemies) {
      const idx = Math.min(Math.floor(e.pathIndex), path.length - 1);
      const pos = path[idx];
      if (pos) {
        const key = `${pos.x},${pos.y}`;
        if (!enemyMap.has(key)) enemyMap.set(key, []);
        enemyMap.get(key).push(e);
      }
    }

    const grid = [];
    for (let y = startY; y < endY; y++) {
      const row = [];
      for (let x = startX; x < endX; x++) {
        const key = `${x},${y}`;

        // Priority: enemy > tower > terrain
        if (enemyMap.has(key)) {
          const enemies = enemyMap.get(key);
          const e = enemies[0]; // Show first enemy
          if (compact) {
            const eDef = this.enemyRegistry.get(e.type);
            row.push({
              t: "enemy",
              s: e.type,
              hp: Math.round((e.hp / e.maxHp) * 100) / 100,
              icon: eDef ? eDef.icon : "fa-bug",
              label: eDef ? eDef.label : e.type,
            });
          } else {
            row.push({ type: "enemy", enemy: e });
          }
        } else if (towerMap.has(key)) {
          const t = towerMap.get(key);
          const tDef = this.towerRegistry.get(t.type);
          if (compact) {
            row.push({ t: "tower", s: t.type, icon: tDef ? tDef.icon : "fa-chess-rook", label: tDef ? tDef.label : t.type });
          } else {
            row.push({ type: "tower", tower: t });
          }
        } else {
          const cellType = cells[y][x];
          if (compact) {
            row.push({ t: cellType });
          } else {
            row.push({ type: cellType, x, y });
          }
        }
      }
      grid.push(row);
    }

    return grid;
  }

  _getViewportWindow(viewportSize) {
    return {
      startX: 0,
      startY: 0,
      width: Math.min(viewportSize, this.state.map.width),
      height: Math.min(viewportSize, this.state.map.height),
    };
  }

  _buildCapabilities() {
    const towerDefs = {};
    for (const t of this.towerRegistry.list()) {
      towerDefs[t.name] = {
        label: t.label,
        cost: t.cost,
        icon: t.icon,
        description: t.description,
        range: t.range,
        damage: t.damage,
        fireRate: t.fireRate,
      };
    }
    const enemyDefs = {};
    for (const e of this.enemyRegistry.list()) {
      enemyDefs[e.name] = { label: e.label, hp: e.hp, speed: e.speed, reward: e.reward, icon: e.icon };
    }
    return {
      actions: ["placeTower", "sellTower", "upgradeTower", "startWave", "tick", "setTheme", "reset", "configure"],
      themes: Object.keys(this.themes),
      towerTypes: this.towerRegistry.names(),
      towerDefs,
      enemyTypes: this.enemyRegistry.names(),
      enemyDefs,
      sizes: Object.keys(this.sizePresets),
      difficulties: this.waveGenerator.listDifficulties(),
      gameModes: this.waveGenerator.listGameModes(),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  _towerAt(x, y) {
    return this.state.towers.some((t) => t.x === x && t.y === y);
  }

  _createRng(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    }
    let state = Math.abs(h) || 1;
    return {
      next() {
        state = (state * 1664525 + 1013904223) & 0x7fffffff;
        return state / 0x7fffffff;
      },
    };
  }

  // ── Public list APIs ───────────────────────────────────────────────

  listThemes() {
    return Object.entries(this.themes).map(([name, t]) => ({
      name,
      label: t.label,
      description: t.description,
      scene: t.scene,
    }));
  }

  listSizes() {
    return Object.entries(this.sizePresets).map(([name, s]) => ({
      name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      ...s,
    }));
  }

  listTowerTypes() {
    return this.towerRegistry.list();
  }

  listEnemyTypes() {
    return this.enemyRegistry.list();
  }

  /**
   * Get preview info for the next wave (enemies that will spawn).
   * Returns null if no next wave (victory/game over).
   */
  getNextWavePreview(options = {}) {
    return this._withSession(options.sessionId, () => {
      if (!this.state) return null;
      if (this.state.stats.gameOver || this.state.stats.victory) return null;

      const nextWave = this.state.wave.status === "complete" ? this.state.wave.current + 1 : this.state.wave.current;

      const totalWaves = this.state.wave.total;
      if (nextWave > totalWaves) return null;

      const gameMode = this.state.gameMode || DEFAULT_GAME_MODE;
      const difficulty = this.state.difficulty || DEFAULT_DIFFICULTY;
      const rng = this._createRng(this.state.map.seed + "-wave-" + nextWave);

      const queue = this.waveGenerator.generate(nextWave, totalWaves, {
        strategy: gameMode,
        difficulty,
        rng,
      });

      // Build enemy preview with scaled stats
      const diffPreset = this.difficultyPresets[difficulty] || DIFFICULTY_PRESETS.normal;
      const level = this.waveGenerator.getEnemyLevel(nextWave);

      const enemyCounts = {};
      for (const enemyType of queue) {
        enemyCounts[enemyType] = (enemyCounts[enemyType] || 0) + 1;
      }

      const enemies = Object.entries(enemyCounts).map(([type, count]) => {
        const def = this.enemyRegistry.get(type);
        const instance = this.enemyRegistry.createInstance(type, "preview", {
          level,
          hpMult: diffPreset.hpMultiplier,
          speedMult: diffPreset.speedMultiplier,
          rewardMult: diffPreset.rewardMultiplier,
        });
        return {
          type,
          label: def ? def.label : type,
          icon: def ? def.icon : "fa-bug",
          count,
          hp: instance.hp,
          speed: instance.speed,
          reward: instance.reward,
        };
      });

      return {
        wave: nextWave,
        total: totalWaves,
        level,
        difficulty,
        enemies,
      };
    });
  }
}

module.exports = new FarmDefenceService();
