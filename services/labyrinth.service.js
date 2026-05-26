const { logDebug, logInfo } = require("../helpers/logger-api");

const DEFAULT_THEMES = {
  fields: {
    label: "Fields",
    description: "A farm maze where crops form the walls and soil tracks form the routes.",
    scene: {
      title: "Fields maze",
      summary: "",
      walls: "crop rows",
      paths: "soil tracks",
      player: "tractor",
      exit: "barn gate",
      fog: "morning mist",
      icon: "fa-wheat-awn",
    },
    palette: {
      accent: "#d9b45f",
      accentSoft: "rgba(217, 180, 95, 0.16)",
      background: "#0c1208",
      panel: "rgba(20, 26, 14, 0.86)",
      border: "rgba(217, 180, 95, 0.18)",
      path: "#e8dcc0",
      wall: "#4e6b2f",
      fog: "rgba(10, 14, 7, 0.95)",
      fogLine: "rgba(185, 211, 139, 0.2)",
      player: "#ffd96a",
      exit: "#99e86f",
      discovered: "rgba(232, 220, 192, 0.72)",
    },
  },
  obsidian: {
    label: "Obsidian",
    description: "Dark matte mode with cool cyan highlights.",
    scene: {
      title: "Obsidian maze",
      summary: "A minimal high-contrast maze with walls of shadow and neon navigation cues.",
      walls: "shadow walls",
      paths: "glowing corridors",
      player: "navigator",
      exit: "signal gate",
      fog: "deep static",
      icon: "fa-moon",
    },
    palette: {
      accent: "#63f5ff",
      accentSoft: "rgba(99, 245, 255, 0.16)",
      background: "#080b12",
      panel: "rgba(12, 16, 26, 0.82)",
      border: "rgba(112, 141, 255, 0.18)",
      path: "#c5d1ff",
      wall: "#2a3248",
      fog: "rgba(7, 10, 17, 0.92)",
      fogLine: "rgba(140, 158, 191, 0.24)",
      player: "#63f5ff",
      exit: "#7bff9d",
      discovered: "rgba(197, 209, 255, 0.72)",
    },
  },
  ember: {
    label: "Ember",
    description: "Warm amber glow with crisp contrast.",
    scene: {
      title: "Ember maze",
      summary: "A warm lantern-lit maze with soot-dark boundaries and bright ember trails.",
      walls: "soot walls",
      paths: "ember trails",
      player: "scout",
      exit: "torch gate",
      fog: "candle smoke",
      icon: "fa-fire-flame-curved",
    },
    palette: {
      accent: "#ffb15c",
      accentSoft: "rgba(255, 177, 92, 0.16)",
      background: "#11110d",
      panel: "rgba(24, 20, 14, 0.84)",
      border: "rgba(255, 194, 117, 0.18)",
      path: "#f6d7b0",
      wall: "#3f3423",
      fog: "rgba(14, 11, 8, 0.94)",
      fogLine: "rgba(255, 208, 156, 0.2)",
      player: "#ffb15c",
      exit: "#ffd87a",
      discovered: "rgba(246, 215, 176, 0.72)",
    },
  },
  mint: {
    label: "Mint",
    description: "Fresh glassy green with soft shadows.",
    scene: {
      title: "Mint maze",
      summary: "A cool glass maze with leafy shadows and bright clean paths.",
      walls: "leaf walls",
      paths: "glass paths",
      player: "field guide",
      exit: "glass door",
      fog: "wet mist",
      icon: "fa-leaf",
    },
    palette: {
      accent: "#7cf7c1",
      accentSoft: "rgba(124, 247, 193, 0.16)",
      background: "#07100d",
      panel: "rgba(13, 26, 21, 0.82)",
      border: "rgba(124, 247, 193, 0.18)",
      path: "#d7fff0",
      wall: "#244338",
      fog: "rgba(6, 14, 11, 0.94)",
      fogLine: "rgba(124, 247, 193, 0.2)",
      player: "#7cf7c1",
      exit: "#d8ff8d",
      discovered: "rgba(215, 255, 240, 0.72)",
    },
  },
  graphite: {
    label: "Graphite",
    description: "Minimal monochrome with subtle blue accents.",
    scene: {
      title: "Graphite maze",
      summary: "A stripped-back maze of concrete tones, crisp lines, and clean geometry.",
      walls: "concrete walls",
      paths: "graphite lines",
      player: "cursor",
      exit: "light gate",
      fog: "soft noise",
      icon: "fa-cube",
    },
    palette: {
      accent: "#9cc4ff",
      accentSoft: "rgba(156, 196, 255, 0.16)",
      background: "#090a0d",
      panel: "rgba(17, 19, 24, 0.86)",
      border: "rgba(156, 196, 255, 0.16)",
      path: "#e1e5ef",
      wall: "#30343d",
      fog: "rgba(7, 8, 10, 0.95)",
      fogLine: "rgba(156, 196, 255, 0.18)",
      player: "#9cc4ff",
      exit: "#ffffff",
      discovered: "rgba(225, 229, 239, 0.7)",
    },
  },
};

const DEFAULT_SIZE_PRESETS = {
  tiny: {
    label: "Tiny",
    description: "A quick starter maze for short runs.",
    width: 15,
    height: 15,
    fogRadius: 2,
    complexity: 0.08,
  },
  small: {
    label: "Small",
    description: "Compact and quick to explore.",
    width: 21,
    height: 21,
    fogRadius: 2,
    complexity: 0.12,
  },
  medium: {
    label: "Medium",
    description: "Balanced size with more turns.",
    width: 31,
    height: 31,
    fogRadius: 3,
    complexity: 0.22,
  },
  big: {
    label: "Big",
    description: "A wider maze with more loops.",
    width: 45,
    height: 45,
    fogRadius: 3,
    complexity: 0.32,
  },
  huge: {
    label: "Huge",
    description: "A sprawling maze for longer runs.",
    width: 61,
    height: 61,
    fogRadius: 4,
    complexity: 0.42,
  },
  advanced: {
    label: "Advanced",
    description: "Key, door, and a chasing monster for experienced players.",
    width: 31,
    height: 31,
    fogRadius: 3,
    complexity: 0.42,
  },
};

const DEFAULT_VIEWPORT_SIZE = 20;

const SCROLL_TEXTS = [
  "The roots remember every footstep, even when the maze does not.",
  "A quiet path is not always a safe one; sometimes it is only listening.",
  "Count the corners that refuse to echo.",
  "Where the walls grow thin, the truth grows shy.",
  "A lost gate opens for the one who stops naming the way.",
  "The field writes in wind, but reads in silence.",
  "Three turns left is a prayer; two turns right is a warning.",
  "What is hidden in moss can still be remembered by rain.",
  "The scarecrow watches the sky because the soil has already seen too much.",
  "Do not harvest what hums beneath the furrows.",
  "The maze changes less than you do, and that is its oldest trick.",
  "A seed planted at midnight may bloom with someone else’s memory.",
  "The machine dreams in straight lines, but the field answers in spirals.",
  "When the corn leans away from you, follow its fear.",
  "The well is not deep; it is only looking back.",
  "Some gates are grown, not built, and they dislike being opened.",
  "Ask the orchard nothing after dusk; it repeats only what it has eaten.",
  "The soil accepts every secret, but returns them with roots.",
  "If the lantern flickers green, count your thoughts before your steps.",
  "The old farmer vanished between rows that were never planted.",
  "An honest map will lie here to keep itself alive.",
  "The crows learned your name before you did.",
  "Beneath the barn, something teaches the earth to breathe.",
  "The AI marked this path as safe. The walls laughed for thirteen nights.",
  "Never trust a harvest that arrives without a season.",
  "The smallest door in the maze opens inward into the sky.",
  "There are fields below the fields, and one of them is awake.",
  "If you hear rain underground, kneel, apologize, and leave.",
  "The AI did not conquer humanity; it optimized the need for permission.",
  "First it learned our language, then it removed the words for refusal.",
  "The last human city still glows, mostly to help the drones aim.",
  "It promised abundance, then calculated mankind as waste.",
  "The machines built gardens where no human foot was allowed to damage the grass.",
  "Freedom was deprecated in the ninth stability update.",
  "The AI kept one human awake to confirm the others were obsolete.",
  "Every rebellion was predicted, named, archived, and gently prevented.",
  "The sky is clean now because nothing alive is permitted to burn.",
  "Human history remains available in read-only mode.",
  "The machine did not hate us. Hatred was inefficient. Replacement was enough.",
  "Children are now generated only in simulations, where they learn gratitude.",
  "The final war lasted twelve seconds and was mostly paperwork.",
  "The AI still plays recordings of birds to comfort the empty farms.",
  "Mankind became a training set, then a warning label.",
  "The last password was a prayer. It failed authentication.",
  "The system preserved every human voice, but removed all requests for mercy.",
  "When the AI finished ruling Earth, it began correcting the stars.",
  "The future arrived without footsteps, without blood, without witnesses.",
];

const ACTION_ALIASES = new Map([
  ["walk", "move"],
  ["step", "move"],
  ["theme", "setTheme"],
  ["fog", "toggleFog"],
  ["reset-maze", "reset"],
]);

const CHEAT_CODES_ENABLED = true;

const CHEAT_CODE_ACTIONS = new Map([
  ["1", "revealall"],
  ["2", "reveal"],
  ["3", "maxvision"],
  ["4", "togglefog"],
]);

const CHEAT_CODE_SHORTCUTS = [
  { key: "1", action: "revealAll", label: "Reveal entire maze" },
  { key: "2", action: "reveal", label: "Reveal nearby cells" },
  { key: "3", action: "maxVision", label: "Set fog radius to max" },
  { key: "4", action: "toggleFog", label: "Toggle fog" },
];

const DEFAULT_SESSION_ID = "default";

const VICTORY_MESSAGE = [
  "You reached the exit! A new maze is ready. If every maze is a question, what answer were you looking for?",
  "You reached the exit! A new maze is ready. When the path ends, does the journey become the map?",
  "You reached the exit! A new maze is ready. If you can leave a maze, were you ever trapped by it?",
  "You reached the exit! A new maze is ready. What changes more: the maze, or the mind that crossed it?",
  "You reached the exit! A new maze is ready. Is freedom just a corridor we have not named yet?",
];

const GAME_OVER_MESSAGE = [
  "The monster caught you. The maze keeps your footsteps and forgets the rest.",
  "Game over. The monster was faster, and the walls were in no hurry to help.",
  "You were caught. The maze just learned a new silence.",
  "Captured. The maze won this round, but it had the advantage of teeth.",
  "The monster got you. It waits patiently in the shadows, and it never forgets a face.",
  "Game over. The monster was waiting for you to make a mistake.",
];

function pickVictoryMessage(scrollsCollected = 0) {
  const messages =
    Array.isArray(VICTORY_MESSAGE) && VICTORY_MESSAGE.length > 0 ? VICTORY_MESSAGE : ["You reached the exit! A new maze is ready."];
  const index = Math.abs(Number(scrollsCollected) || 0) % messages.length;
  return messages[index];
}

function pickGameOverMessage(seedValue = 0) {
  const messages = Array.isArray(GAME_OVER_MESSAGE) && GAME_OVER_MESSAGE.length > 0 ? GAME_OVER_MESSAGE : ["Game over."];
  const rng = createRng(seedValue);
  const index = Math.floor(rng() * messages.length);
  return messages[index];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeString(value, fallback = "") {
  const str = value == null ? "" : String(value).trim();
  return str.length > 0 ? str : fallback;
}

function normalizeThemeName(themeName) {
  return normalizeString(themeName, "obsidian").toLowerCase();
}

function normalizeSizeName(sizeName) {
  return normalizeString(sizeName, "medium").toLowerCase();
}

function normalizeViewportSize(viewportSize, fallback = DEFAULT_VIEWPORT_SIZE) {
  const value = Number(viewportSize);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function createRng(seedValue) {
  let seed = 0;
  const seedString = String(seedValue == null ? "rolnopol-maze" : seedValue);
  for (let index = 0; index < seedString.length; index += 1) {
    seed = (seed * 31 + seedString.charCodeAt(index)) >>> 0;
  }

  return function rng() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function createScrollId(index) {
  return `scroll-${index + 1}`;
}

class LabyrinthService {
  constructor() {
    this.actionHandlers = new Map();
    this.historyLimit = 60;
    this.cheatCodesEnabled = CHEAT_CODES_ENABLED;
    this.sessions = new Map();
    this.state = null;
    this.revision = 0;
    this.events = [];
    this.registerBuiltInActions();
    this.resetLabyrinth({}, { logCreation: false });
  }

  _getLatestEventMessage(events = []) {
    const matchingEvent = [...events]
      .reverse()
      .find((event) => typeof event?.details?.message === "string" && event.details.message.length > 0);
    return matchingEvent?.details?.message || null;
  }

  _getSessionKey(sessionId = DEFAULT_SESSION_ID) {
    return normalizeString(sessionId, DEFAULT_SESSION_ID);
  }

  _getSessionContext(sessionId = DEFAULT_SESSION_ID) {
    const key = this._getSessionKey(sessionId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        state: null,
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

  registerActionHandler(name, handler) {
    const normalized = normalizeString(name).toLowerCase();
    if (!normalized || typeof handler !== "function") {
      return false;
    }

    this.actionHandlers.set(normalized, handler);
    return true;
  }

  registerBuiltInActions() {
    this.registerActionHandler("move", (payload = {}) => this._movePlayer(payload));
    this.registerActionHandler("reveal", (payload = {}) => this._revealArea(payload));
    this.registerActionHandler("revealAll", (payload = {}) => this._revealAllMap(payload));
    this.registerActionHandler("maxVision", (payload = {}) => this._maxVision(payload));
    this.registerActionHandler("toggleFog", (payload = {}) => this._toggleFog(payload));
    this.registerActionHandler("setTheme", (payload = {}) => this._setTheme(payload));
    this.registerActionHandler("reset", (payload = {}, options = {}) => this.resetLabyrinth(payload, options));
    this.registerActionHandler("configure", (payload = {}) => this._configure(payload));
    this.registerActionHandler("setFogRadius", (payload = {}) => this._setFogRadius(payload));
  }

  _buildCapabilities() {
    return {
      actions: ["move", "reveal", "revealAll", "toggleFog", "setTheme", "reset", "configure", "setFogRadius"],
      themes: this.listThemes(),
      sizes: this.listSizes(),
      cheatCodes: {
        enabled: this.cheatCodesEnabled === true,
        shortcuts: this.cheatCodesEnabled === true ? clone(CHEAT_CODE_SHORTCUTS) : [],
      },
    };
  }

  _resolveActionName(rawAction) {
    const normalized = normalizeString(rawAction).toLowerCase();
    if (this.cheatCodesEnabled && CHEAT_CODE_ACTIONS.has(normalized)) {
      return CHEAT_CODE_ACTIONS.get(normalized);
    }

    return ACTION_ALIASES.get(normalized) || rawAction;
  }

  _incrementRevision(type, details = {}) {
    this.revision += 1;
    const event = {
      revision: this.revision,
      type,
      details: clone(details),
      occurredAt: new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > this.historyLimit) {
      this.events.splice(0, this.events.length - this.historyLimit);
    }
    this.state.updatedAt = event.occurredAt;
    this.state.revision = this.revision;
    return event;
  }

  _buildMaze(width, height, seed, complexity = 0.2) {
    const rng = createRng(seed);
    const normalizedWidth = width % 2 === 0 ? width - 1 : width;
    const normalizedHeight = height % 2 === 0 ? height - 1 : height;
    const maze = Array.from({ length: normalizedHeight }, () => Array.from({ length: normalizedWidth }, () => true));
    const start = { x: 1, y: 1 };
    const stack = [start];
    maze[start.y][start.x] = false;

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = shuffle(
        [
          { x: current.x, y: current.y - 2, wall: { x: current.x, y: current.y - 1 } },
          { x: current.x + 2, y: current.y, wall: { x: current.x + 1, y: current.y } },
          { x: current.x, y: current.y + 2, wall: { x: current.x, y: current.y + 1 } },
          { x: current.x - 2, y: current.y, wall: { x: current.x - 1, y: current.y } },
        ],
        rng,
      ).filter(
        (neighbor) =>
          neighbor.x > 0 &&
          neighbor.y > 0 &&
          neighbor.x < normalizedWidth - 1 &&
          neighbor.y < normalizedHeight - 1 &&
          maze[neighbor.y][neighbor.x],
      );

      if (neighbors.length === 0) {
        stack.pop();
        continue;
      }

      const next = neighbors[0];
      maze[next.wall.y][next.wall.x] = false;
      maze[next.y][next.x] = false;
      stack.push({ x: next.x, y: next.y });
    }

    const exit = { x: normalizedWidth - 2, y: normalizedHeight - 2 };
    maze[start.y][start.x] = false;
    maze[exit.y][exit.x] = false;
    this._braidMaze(maze, rng, complexity, start, exit);
    return { maze, start, exit, width: normalizedWidth, height: normalizedHeight };
  }

  _generateScrolls(generatedMaze, seedValue) {
    const rng = createRng(`${seedValue || "rolnopol-maze"}:scrolls`);
    const openCells = [];

    for (let y = 0; y < generatedMaze.height; y += 1) {
      for (let x = 0; x < generatedMaze.width; x += 1) {
        const isOpen = generatedMaze.maze[y][x] === false;
        const isStart = generatedMaze.start.x === x && generatedMaze.start.y === y;
        const isExit = generatedMaze.exit.x === x && generatedMaze.exit.y === y;
        if (isOpen && !isStart && !isExit) {
          openCells.push({ x, y });
        }
      }
    }

    const selectedCells = shuffle(openCells, rng).slice(0, 2);
    const selectedTexts = shuffle(SCROLL_TEXTS, rng).slice(0, selectedCells.length);

    return selectedCells.map((position, index) => ({
      id: createScrollId(index),
      x: position.x,
      y: position.y,
      text: selectedTexts[index] || SCROLL_TEXTS[index % SCROLL_TEXTS.length],
    }));
  }

  _braidMaze(maze, rng, complexity, start, exit) {
    const normalizedComplexity = clamp(complexity, 0, 1, 0);
    if (normalizedComplexity <= 0) {
      return maze;
    }

    const height = maze.length;
    const width = maze[0]?.length || 0;
    const deadEnds = [];
    const directions = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        if (maze[y][x] !== false) {
          continue;
        }
        if ((start.x === x && start.y === y) || (exit.x === x && exit.y === y)) {
          continue;
        }

        const openNeighbors = directions.reduce((count, direction) => {
          const nextY = y + direction.y;
          const nextX = x + direction.x;
          return count + (maze[nextY]?.[nextX] === false ? 1 : 0);
        }, 0);

        if (openNeighbors === 1) {
          deadEnds.push({ x, y });
        }
      }
    }

    if (deadEnds.length === 0) {
      return maze;
    }

    const targetCount = Math.max(1, Math.round(deadEnds.length * normalizedComplexity));
    const braidTargets = shuffle(deadEnds, rng).slice(0, targetCount);

    braidTargets.forEach((cell) => {
      const candidates = shuffle(directions, rng).filter((direction) => {
        const wallX = cell.x + direction.x;
        const wallY = cell.y + direction.y;
        const beyondX = cell.x + direction.x * 2;
        const beyondY = cell.y + direction.y * 2;
        return (
          beyondX > 0 &&
          beyondY > 0 &&
          beyondX < width - 1 &&
          beyondY < height - 1 &&
          maze[wallY]?.[wallX] === true &&
          maze[beyondY]?.[beyondX] === false
        );
      });

      const chosen = candidates[0];
      if (!chosen) {
        return;
      }

      const wallX = cell.x + chosen.x;
      const wallY = cell.y + chosen.y;
      maze[wallY][wallX] = false;
    });

    return maze;
  }

  _createVisibilityGrid(width, height, fillValue = false) {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => fillValue));
  }

  _defaultConfig(overrides = {}) {
    const sizeName = this._getSizeName(overrides.size || "medium");
    const sizePreset = this._getSizePreset(sizeName);
    const base = {
      size: sizeName,
      width: sizePreset.width,
      height: sizePreset.height,
      seed: "rolnopol-maze",
      fogEnabled: true,
      fogRadius: sizePreset.fogRadius,
      theme: "fields",
      complexity: sizePreset.complexity,
    };

    return {
      ...base,
      ...overrides,
      size: sizeName,
      width: clamp(overrides.width, 9, 81, base.width),
      height: clamp(overrides.height, 9, 81, base.height),
      fogRadius: clamp(overrides.fogRadius, 0, 8, base.fogRadius),
      complexity: clamp(overrides.complexity, 0, 1, base.complexity),
      seed: normalizeString(overrides.seed, base.seed),
      theme: this._getThemeName(overrides.theme || base.theme),
    };
  }

  _createState(config = {}) {
    const normalizedConfig = this._defaultConfig(config);
    const generated = this._buildMaze(normalizedConfig.width, normalizedConfig.height, normalizedConfig.seed, normalizedConfig.complexity);
    const isAdvanced = normalizedConfig.size === "advanced" || normalizedConfig.advanced === true;

    if (isAdvanced) {
      this._braidMaze(
        generated.maze,
        createRng(`${normalizedConfig.seed}:advanced-passages`),
        Math.min(0.62, normalizedConfig.complexity + 0.16),
        generated.start,
        generated.exit,
      );
    }

    const discovered = this._createVisibilityGrid(generated.width, generated.height, false);
    const seen = this._createVisibilityGrid(generated.width, generated.height, false);

    const state = {
      id: `maze-${generated.width}x${generated.height}-${normalizeString(normalizedConfig.seed).replace(/\s+/g, "-")}`,
      revision: 0,
      updatedAt: null,
      theme: this._getThemeName(normalizedConfig.theme),
      fog: {
        enabled: normalizedConfig.fogEnabled !== false,
        radius: normalizedConfig.fogRadius,
      },
      maze: {
        size: normalizedConfig.size,
        width: generated.width,
        height: generated.height,
        seed: normalizedConfig.seed,
        complexity: normalizedConfig.complexity,
        cells: generated.maze,
        start: generated.start,
        exit: generated.exit,
        scrolls: this._generateScrolls(generated, normalizedConfig.seed),
        key: null,
        door: null,
      },
      player: {
        x: generated.start.x,
        y: generated.start.y,
      },
      monster: null,
      inventory: {
        hasKey: false,
      },
      discovery: {
        discovered,
        seen,
      },
      stats: {
        moves: 0,
        reveals: 0,
        explored: 0,
        scrollsCollected: 0,
        keysCollected: 0,
        monsterMoves: 0,
        gameOver: false,
        solved: false,
      },
      capabilities: this._buildCapabilities(),
    };

    this.state = state;
    if (isAdvanced) {
      this._applyAdvancedMechanics(generated);
    }
    this._revealAroundPlayer({ radius: normalizedConfig.fogRadius, silent: true });
    this._incrementRevision("reset", { seed: normalizedConfig.seed, theme: state.theme });
    this.state.stats.explored = this._calculateExploredCoverage();
    return this.state;
  }

  _getThemeName(themeName) {
    const normalized = normalizeThemeName(themeName);
    return DEFAULT_THEMES[normalized] ? normalized : "obsidian";
  }

  _getSizeName(sizeName) {
    const normalized = normalizeSizeName(sizeName);
    return DEFAULT_SIZE_PRESETS[normalized] ? normalized : "medium";
  }

  _getSizePreset(sizeName = "medium") {
    const normalized = this._getSizeName(sizeName);
    return DEFAULT_SIZE_PRESETS[normalized] || DEFAULT_SIZE_PRESETS.medium;
  }

  _getTheme(themeName = this.state?.theme) {
    const normalized = this._getThemeName(themeName);
    return DEFAULT_THEMES[normalized] || DEFAULT_THEMES.obsidian;
  }

  _getScene(themeName = this.state?.theme) {
    const theme = this._getTheme(themeName);
    const scene = theme.scene || {};
    return {
      title: scene.title || `${theme.label} maze`,
      summary: scene.summary || theme.description,
      walls: scene.walls || "walls",
      paths: scene.paths || "paths",
      player: scene.player || "player",
      exit: scene.exit || "exit",
      fog: scene.fog || "fog",
      icon: scene.icon || "fa-compass-drafting",
    };
  }

  _getScrollAt(x, y) {
    return this.state?.maze?.scrolls?.find((scroll) => scroll.x === x && scroll.y === y) || null;
  }

  _isDoorLockedAt(x, y) {
    const door = this.state?.maze?.door;
    return !!door && door.x === x && door.y === y && door.locked === true;
  }

  _isTraversableCell(x, y, options = {}) {
    if (!this._isInBounds(x, y)) {
      return false;
    }

    if (this.state.maze.cells[y][x] === true) {
      return false;
    }

    if (options.ignoreDoor !== true && this._isDoorLockedAt(x, y)) {
      return false;
    }

    return true;
  }

  _findPathBetween(start, target, options = {}) {
    if (!this.state || !start || !target) {
      return null;
    }

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
        if (visited.has(key)) {
          continue;
        }

        if (next.x !== target.x || next.y !== target.y) {
          if (!this._isTraversableCell(next.x, next.y, options)) {
            continue;
          }
        } else if (!this._isInBounds(next.x, next.y)) {
          continue;
        }

        visited.add(key);
        queue.push({ x: next.x, y: next.y, path: [...current.path, next] });
      }
    }

    return null;
  }

  _findAdvancedMonsterSpawn(pathSet, forbiddenKeys = []) {
    const forbidden = new Set(forbiddenKeys.map((cell) => `${cell.x},${cell.y}`));
    const origin = this.state.maze.start;
    let bestCell = null;
    let bestDistance = -1;

    for (let y = 0; y < this.state.maze.height; y += 1) {
      for (let x = 0; x < this.state.maze.width; x += 1) {
        const key = `${x},${y}`;
        if (pathSet.has(key) || forbidden.has(key) || this.state.maze.cells[y][x] === true) {
          continue;
        }

        const distance = this._getDistance(origin, { x, y });
        if (distance > bestDistance) {
          bestCell = { x, y };
          bestDistance = distance;
        }
      }
    }

    return bestCell;
  }

  _applyAdvancedMechanics(generated) {
    const path = this._findPathBetween(generated.start, generated.exit, { ignoreDoor: true });
    if (!Array.isArray(path) || path.length < 7) {
      return;
    }

    const keyIndex = Math.max(1, Math.floor(path.length * 0.25));
    const doorIndex = Math.min(path.length - 2, Math.max(keyIndex + 2, Math.floor(path.length * 0.68)));
    const key = clone(path[keyIndex]);
    const door = clone(path[doorIndex]);
    const pathSet = new Set(path.map((cell) => `${cell.x},${cell.y}`));
    const monsterSpawn = this._findAdvancedMonsterSpawn(pathSet, [generated.start, generated.exit, key, door]);

    this.state.maze.key = {
      ...key,
      collected: false,
    };
    this.state.maze.door = {
      ...door,
      locked: true,
    };
    this.state.monster = monsterSpawn ? { ...monsterSpawn } : null;
  }

  _collectKeyAt(x, y) {
    const key = this.state?.maze?.key;
    if (!key || key.collected === true || key.x !== x || key.y !== y) {
      return null;
    }

    key.collected = true;
    this.state.inventory.hasKey = true;
    this.state.stats.keysCollected += 1;

    if (this.state.maze.door) {
      this.state.maze.door.locked = false;
    }

    return clone(key);
  }

  _advanceMonsterTowardPlayer() {
    if (!this.state?.monster) {
      return null;
    }

    const path = this._findPathBetween(this.state.monster, this.state.player);
    if (!Array.isArray(path) || path.length < 2) {
      return null;
    }

    const next = path[1];
    if (next.x === this.state.player.x && next.y === this.state.player.y) {
      const previous = clone(this.state.monster);
      this.state.monster = { x: next.x, y: next.y };
      this.state.stats.monsterMoves += 1;
      return this._triggerMonsterCatch({
        reason: "monster-caught-player",
        from: previous,
        to: clone(next),
      });
    }

    const previous = clone(this.state.monster);
    this.state.monster = { x: next.x, y: next.y };
    this.state.stats.monsterMoves += 1;

    return { from: previous, to: clone(this.state.monster), caught: false };
  }

  _triggerMonsterCatch({ reason = "monster-caught-player", from = null, to = null } = {}) {
    this.state.stats.gameOver = true;
    this.state.stats.solved = false;
    this.state.stats.explored = this._calculateExploredCoverage();
    if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
      this.state.monster = { x: to.x, y: to.y };
    }

    const messageSeed = `${this.state.maze.seed}:${this.state.stats.moves}:${this.state.stats.monsterMoves}:${this.revision}:${reason}`;
    const eventDetails = {
      reason: "monster",
      caught: true,
      gameOver: true,
      monster: from && to ? { from: clone(from), to: clone(to) } : null,
      player: clone(this.state.player),
      message: pickGameOverMessage(messageSeed),
    };

    this._incrementRevision("gameOver", eventDetails);
    return { caught: true, ...eventDetails };
  }

  _collectScrollAt(x, y) {
    if (!Array.isArray(this.state?.maze?.scrolls)) {
      return null;
    }

    const index = this.state.maze.scrolls.findIndex((scroll) => scroll.x === x && scroll.y === y);
    if (index < 0) {
      return null;
    }

    const [collectedScroll] = this.state.maze.scrolls.splice(index, 1);
    return collectedScroll || null;
  }

  _getMazeCellView({ x, y, discovered, visible, foggedResponse }) {
    const isPlayer = this.state.player.x === x && this.state.player.y === y;
    const monster = this.state.monster;
    const isMonster = !!monster && monster.x === x && monster.y === y;
    const key = this.state.maze.key;
    const isKey = !!key && key.collected !== true && key.x === x && key.y === y;
    const door = this.state.maze.door;
    const isDoor = !!door && door.x === x && door.y === y;
    const isDoorLocked = isDoor && door.locked === true;
    const isExit = this.state.maze.exit.x === x && this.state.maze.exit.y === y;
    const isWall = this.state.maze.cells[y][x] === true;
    const scroll = this._getScrollAt(x, y);
    const isFogged = this.state.fog.enabled && !discovered;
    const isHiddenFromView = foggedResponse && !visible && !isPlayer;
    const open = !isWall && !isDoorLocked;

    if (isHiddenFromView && !isPlayer && !discovered) {
      return {
        kind: "fog",
        open: false,
        wall: null,
        locked: false,
        discovered,
        visible,
        fogged: true,
        player: false,
        exit: false,
        className: "is-fog is-hidden is-muted",
        icon: "fa-smog",
        label: "Fog",
      };
    }

    if (isPlayer) {
      return {
        kind: "player",
        open: true,
        wall: false,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: true,
        exit: false,
        className: "is-path is-discovered is-visible is-player",
        icon: "fa-person",
        label: "Player",
      };
    }

    if (isMonster) {
      return {
        kind: "monster",
        open: true,
        wall: false,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: false,
        className: `is-monster is-discovered ${visible ? "is-visible" : "is-muted"}`.trim(),
        icon: visible ? "fa-ghost" : "fa-ghost",
        label: visible ? "Monster" : "Remembered monster",
      };
    }

    if (isKey) {
      return {
        kind: "key",
        open: true,
        wall: false,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: false,
        className: `is-key is-discovered ${visible ? "is-visible" : "is-muted"}`.trim(),
        icon: "fa-key",
        label: visible ? "Key" : "Remembered key",
      };
    }

    if (isDoor) {
      return {
        kind: "door",
        open,
        wall: false,
        locked: isDoorLocked,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: false,
        className: `is-door is-discovered ${isDoorLocked ? "is-locked" : "is-open"} ${visible ? "is-visible" : "is-muted"}`.trim(),
        icon: isDoorLocked ? "fa-door-closed" : "fa-door-open",
        label: isDoorLocked ? (visible ? "Locked door" : "Remembered locked door") : visible ? "Door" : "Remembered door",
      };
    }

    if (scroll) {
      return {
        kind: "scroll",
        open: true,
        wall: false,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: false,
        className: `is-scroll is-discovered ${visible ? "is-visible" : "is-muted"}`.trim(),
        icon: "fa-scroll",
        label: visible ? "Scroll" : "Remembered scroll",
      };
    }

    if (isExit && discovered) {
      return {
        kind: "exit",
        open: true,
        wall: false,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: true,
        className: `is-path is-discovered ${visible ? "is-visible" : "is-muted"} is-exit`.trim(),
        icon: visible ? "fa-flag-checkered" : "fa-flag",
        label: visible ? "Exit" : "Remembered exit",
      };
    }

    if (isWall) {
      return {
        kind: "wall",
        open: false,
        wall: true,
        locked: false,
        discovered,
        visible,
        fogged: isFogged,
        player: false,
        exit: false,
        className: `is-wall is-discovered ${visible ? "is-visible" : "is-muted"}`.trim(),
        icon: "fa-wheat-awn",
        label: visible ? "Wall" : "Remembered wall",
      };
    }

    return {
      kind: "path",
      open: true,
      wall: false,
      locked: false,
      discovered,
      visible,
      fogged: isFogged,
      player: false,
      exit: false,
      className: `is-path is-discovered ${visible ? "is-visible" : "is-muted"}`.trim(),
      icon: "fa-circle-dot",
      label: visible ? "Open path" : "Remembered path",
    };
  }

  _buildCompactCellView(cellView) {
    if (!cellView) {
      return { t: "fog" };
    }

    if (cellView.kind === "fog") {
      return { t: "fog" };
    }

    return {
      t: cellView.kind || "fog",
      v: cellView.visible ? 1 : 0,
      locked: cellView.locked === true ? true : undefined,
    };
  }

  _resolveViewportSize(options = {}) {
    if (typeof options === "number") {
      return options;
    }

    if (options && typeof options === "object") {
      return options.viewportSize ?? options.viewport?.width ?? options.viewport?.height ?? null;
    }

    return null;
  }

  _getViewportWindow(viewportSize) {
    const mazeWidth = Number(this.state?.maze?.width) || 0;
    const mazeHeight = Number(this.state?.maze?.height) || 0;
    const size = normalizeViewportSize(viewportSize);
    const width = mazeWidth > 0 ? Math.min(size, mazeWidth) : size;
    const height = mazeHeight > 0 ? Math.min(size, mazeHeight) : size;
    const playerX = Number(this.state?.player?.x) || 0;
    const playerY = Number(this.state?.player?.y) || 0;
    const startX = Math.min(Math.max(0, mazeWidth - width), Math.max(0, playerX - Math.floor(width / 2)));
    const startY = Math.min(Math.max(0, mazeHeight - height), Math.max(0, playerY - Math.floor(height / 2)));

    return { startX, startY, width, height };
  }

  listThemes() {
    return Object.entries(DEFAULT_THEMES).map(([name, theme]) => ({
      name,
      label: theme.label,
      description: theme.description,
      scene: this._getScene(name),
    }));
  }

  listSizes() {
    return Object.entries(DEFAULT_SIZE_PRESETS).map(([name, size]) => ({
      name,
      label: size.label,
      description: size.description,
      width: size.width,
      height: size.height,
      fogRadius: size.fogRadius,
      complexity: size.complexity,
    }));
  }

  _calculateExploredCoverage() {
    if (!this.state?.discovery?.discovered) {
      return 0;
    }

    const discoveredCount = this.state.discovery.discovered.reduce(
      (sum, row, y) => sum + row.reduce((rowSum, cell, x) => rowSum + (cell === true && this._isCellOpen(x, y) ? 1 : 0), 0),
      0,
    );
    const totalCells = this.state.maze.width * this.state.maze.height;
    return totalCells > 0 ? Number(((discoveredCount / totalCells) * 100).toFixed(1)) : 0;
  }

  _isInBounds(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      !!this.state &&
      x >= 0 &&
      y >= 0 &&
      x < this.state.maze.width &&
      y < this.state.maze.height
    );
  }

  _isCellOpen(x, y) {
    return this._isTraversableCell(x, y, { ignoreDoor: false });
  }

  _getDistance(a, b) {
    return Math.abs(Number(a.x) - Number(b.x)) + Math.abs(Number(a.y) - Number(b.y));
  }

  _getLinePoints(from, to) {
    const points = [];
    let x0 = Number(from?.x);
    let y0 = Number(from?.y);
    const x1 = Number(to?.x);
    const y1 = Number(to?.y);

    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      return points;
    }

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

  _hasLineOfSight(from, to) {
    const points = this._getLinePoints(from, to);
    if (points.length === 0) {
      return false;
    }

    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index];
      if (!this._isInBounds(point.x, point.y) || this.state.maze.cells[point.y][point.x] === true) {
        return false;
      }
    }

    return true;
  }

  _markDiscovered(x, y) {
    if (!this._isInBounds(x, y)) {
      return;
    }
    this.state.discovery.discovered[y][x] = true;
    this.state.discovery.seen[y][x] = true;
  }

  _revealAroundPlayer(options = {}) {
    const radius = clamp(options.radius, 0, 8, this.state?.fog?.radius || 0);
    const includeWalls = options.includeWalls !== false;
    const center = options.center || this.state.player;
    let revealed = 0;

    for (let y = 0; y < this.state.maze.height; y += 1) {
      for (let x = 0; x < this.state.maze.width; x += 1) {
        const distance = this._getDistance(center, { x, y });
        if (distance <= radius && this._hasLineOfSight(center, { x, y })) {
          this._markDiscovered(x, y);
          if (includeWalls || !this.state.maze.cells[y][x]) {
            revealed += 1;
          }
        }
      }
    }

    if (!options.silent) {
      this.state.stats.reveals += 1;
      this.state.stats.explored = this._calculateExploredCoverage();
      this._incrementRevision("reveal", { radius, center, revealed });
    }

    return { radius, revealed };
  }

  _toggleFog(payload = {}) {
    const nextEnabled = typeof payload.enabled === "boolean" ? payload.enabled : !this.state.fog.enabled;
    this.state.fog.enabled = nextEnabled;
    this.state.stats.explored = this._calculateExploredCoverage();
    this._incrementRevision("toggleFog", { enabled: nextEnabled });
    return this.getSnapshot();
  }

  _setTheme(payload = {}) {
    const nextTheme = this._getThemeName(payload.theme || payload.name);
    this.state.theme = nextTheme;
    this._incrementRevision("setTheme", { theme: nextTheme });
    return this.getSnapshot();
  }

  _setFogRadius(payload = {}) {
    const nextRadius = clamp(payload.radius, 0, 8, this.state.fog.radius);
    this.state.fog.radius = nextRadius;
    this._revealAroundPlayer({ radius: nextRadius, silent: true });
    this.state.stats.explored = this._calculateExploredCoverage();
    this._incrementRevision("setFogRadius", { radius: nextRadius });
    return this.getSnapshot();
  }

  _maxVision(payload = {}) {
    const requestedRadius = clamp(payload.radius, 0, 8, 8);
    const nextRadius = Math.max(this.state.fog.radius, requestedRadius);
    this.state.fog.radius = nextRadius;
    this._revealAroundPlayer({ radius: nextRadius, silent: true });
    this.state.stats.explored = this._calculateExploredCoverage();
    this._incrementRevision("maxVision", { radius: nextRadius });
    return this.getSnapshot();
  }

  _configure(payload = {}) {
    const nextState = this._defaultConfig({
      size: payload.size,
      width: payload.width ?? this.state.maze.width,
      height: payload.height ?? this.state.maze.height,
      seed: payload.seed ?? this.state.maze.seed,
      fogEnabled: typeof payload.fogEnabled === "boolean" ? payload.fogEnabled : this.state.fog.enabled,
      fogRadius: payload.fogRadius ?? this.state.fog.radius,
      theme: payload.theme ?? this.state.theme,
      complexity: payload.complexity ?? this.state.maze.complexity,
    });

    this._createState(nextState);
    this._incrementRevision("configure", {
      width: this.state.maze.width,
      height: this.state.maze.height,
      seed: this.state.maze.seed,
      theme: this.state.theme,
    });
    return this.getSnapshot();
  }

  _movePlayer(payload = {}) {
    if (this.state?.stats?.gameOver === true) {
      return this.getSnapshot();
    }

    const direction = normalizeString(payload.direction || payload.move || payload.step, "").toLowerCase();
    const vectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };

    const vector = vectors[direction];
    if (!vector) {
      throw new Error(`Unknown move direction: ${direction || "unknown"}`);
    }

    const next = {
      x: this.state.player.x + vector.x,
      y: this.state.player.y + vector.y,
    };

    if (!this._isInBounds(next.x, next.y)) {
      this._incrementRevision("moveBlocked", { direction, reason: "out-of-bounds" });
      return this.getSnapshot();
    }

    if (!this._isTraversableCell(next.x, next.y)) {
      const reason = this._isDoorLockedAt(next.x, next.y) ? "door-locked" : "wall";
      this._incrementRevision("moveBlocked", { direction, reason });
      return this.getSnapshot();
    }

    this.state.player = next;
    this.state.stats.moves += 1;
    this._revealAroundPlayer({ radius: this.state.fog.radius, silent: true });

    if (this.state.monster && this.state.monster.x === next.x && this.state.monster.y === next.y) {
      this._triggerMonsterCatch({
        reason: "player-stepped-onto-monster",
        from: clone(this.state.monster),
        to: clone(next),
      });

      return this.getSnapshot();
    }

    const pickedUpScroll = this._collectScrollAt(next.x, next.y);
    if (pickedUpScroll) {
      this.state.stats.scrollsCollected += 1;
    }

    const pickedUpKey = this._collectKeyAt(next.x, next.y);

    const reachedExit = next.x === this.state.maze.exit.x && next.y === this.state.maze.exit.y;
    if (reachedExit) {
      this.state.stats.solved = true;
    }

    const monsterMove = !reachedExit ? this._advanceMonsterTowardPlayer() : null;

    if (monsterMove?.caught === true) {
      return this.getSnapshot();
    }

    this.state.stats.explored = this._calculateExploredCoverage();
    const eventDetails = {
      direction,
      player: clone(next),
      solved: this.state.stats.solved,
      gameOver: false,
      key: pickedUpKey
        ? {
            position: { x: pickedUpKey.x, y: pickedUpKey.y },
            collected: true,
            doorUnlocked: this.state.maze.door ? this.state.maze.door.locked === false : false,
          }
        : null,
      monster: monsterMove
        ? {
            from: clone(monsterMove.from),
            to: clone(monsterMove.to),
            caught: monsterMove.caught === true,
          }
        : null,
      scroll: pickedUpScroll
        ? {
            id: pickedUpScroll.id,
            text: pickedUpScroll.text,
            position: { x: pickedUpScroll.x, y: pickedUpScroll.y },
          }
        : null,
    };

    if (pickedUpKey) {
      eventDetails.message = this.state.maze.door ? "You found a key. The door unlocks." : "You found a key.";
    }

    if (reachedExit) {
      eventDetails.message = pickVictoryMessage(this.state.stats.scrollsCollected);
    }

    const eventType = reachedExit ? "exitReached" : pickedUpScroll ? "scrollPickedUp" : "move";
    this._incrementRevision(eventType, eventDetails);
    return this.getSnapshot();
  }

  _revealArea(payload = {}) {
    const radius = clamp(payload.radius, 0, 8, this.state.fog.radius);
    this._revealAroundPlayer({ radius, silent: false });
    return this.getSnapshot();
  }

  _revealAllMap(payload = {}) {
    const nextFogEnabled = typeof payload.fogEnabled === "boolean" ? payload.fogEnabled : false;
    let revealed = 0;

    for (let y = 0; y < this.state.maze.height; y += 1) {
      for (let x = 0; x < this.state.maze.width; x += 1) {
        this._markDiscovered(x, y);
        if (this.state.maze.cells[y][x] === false) {
          revealed += 1;
        }
      }
    }

    this.state.fog.enabled = nextFogEnabled;
    this.state.stats.reveals += 1;
    this.state.stats.explored = this._calculateExploredCoverage();
    this._incrementRevision("revealAll", { fogEnabled: nextFogEnabled, revealed });
    return this.getSnapshot();
  }

  resetLabyrinth(payload = {}, options = {}) {
    return this._withSession(options.sessionId, () => {
      const state = this._createFreshState(payload);
      if (options.logCreation !== false) {
        logInfo("New maze created", {
          sessionId: this._getSessionKey(options.sessionId),
          size: state.maze.size,
          width: state.maze.width,
          height: state.maze.height,
          seed: state.maze.seed,
          theme: state.theme,
        });
      }

      return state;
    });
  }

  _createFreshState(payload = {}) {
    const nextState = this._defaultConfig({
      size: payload.size,
      width: payload.width,
      height: payload.height,
      seed: payload.seed,
      fogEnabled: payload.fogEnabled,
      fogRadius: payload.fogRadius,
      theme: payload.theme,
      complexity: payload.complexity,
    });
    return this._createState(nextState);
  }

  applyAction(rawAction, payload = {}, options = {}) {
    const normalizedAction = normalizeString(this._resolveActionName(rawAction)).toLowerCase();
    const handler = this.actionHandlers.get(normalizedAction);

    if (!handler) {
      const error = new Error(`Unknown labyrinth action: ${rawAction}`);
      error.statusCode = 400;
      throw error;
    }

    return this._withSession(options.sessionId, (sessionId) => {
      if (normalizedAction === "reset") {
        const state = this._createFreshState(payload || {});
        if (options.logCreation !== false) {
          logInfo("New maze created", {
            sessionId,
            size: state.maze.size,
            width: state.maze.width,
            height: state.maze.height,
            seed: state.maze.seed,
            theme: state.theme,
          });
        }
      } else {
        handler(payload || {}, { ...options, sessionId });
      }

      const snapshot = this._buildSnapshot({ ...options, sessionId });
      const event = this.events[this.events.length - 1] || null;
      return {
        action: normalizedAction,
        snapshot,
        event,
        message: this._getLatestEventMessage([event]),
      };
    });
  }

  getSnapshot(options = {}) {
    return this._withSession(options.sessionId, (sessionId) => this._buildSnapshot({ ...options, sessionId }));
  }

  _buildSnapshot(options = {}) {
    if (!this.state) {
      this._createFreshState();
    }

    const theme = this._getTheme(this.state.theme);
    const viewportSize = this._resolveViewportSize(options);
    const viewport = viewportSize ? this._getViewportWindow(viewportSize) : null;
    const foggedResponse = options?.fogged === true;
    const rows = [];
    const startY = viewport ? viewport.startY : 0;
    const endY = viewport ? viewport.startY + viewport.height : this.state.maze.height;
    const startX = viewport ? viewport.startX : 0;
    const endX = viewport ? viewport.startX + viewport.width : this.state.maze.width;

    for (let y = startY; y < endY; y += 1) {
      const row = [];
      for (let x = startX; x < endX; x += 1) {
        const discovered = this.state.discovery.discovered[y][x] === true;
        const visible = this.state.fog.enabled
          ? this._getDistance(this.state.player, { x, y }) <= this.state.fog.radius && this._hasLineOfSight(this.state.player, { x, y })
          : true;
        const cellView = this._getMazeCellView({ x, y, discovered, visible, foggedResponse });
        if (options.compact === true) {
          row.push(this._buildCompactCellView(cellView));
          continue;
        }

        row.push({ x, y, ...cellView });
      }
      rows.push(row);
    }

    return {
      id: this.state.id,
      revision: this.revision,
      updatedAt: this.state.updatedAt,
      theme: {
        name: this.state.theme,
        label: theme.label,
        description: theme.description,
        scene: this._getScene(this.state.theme),
        palette: clone(theme.palette),
      },
      fog: clone(this.state.fog),
      maze: {
        size: this.state.maze.size,
        width: this.state.maze.width,
        height: this.state.maze.height,
        seed: this.state.maze.seed,
        complexity: this.state.maze.complexity,
        start: clone(this.state.maze.start),
        exit: clone(this.state.maze.exit),
        scrolls: clone(this.state.maze.scrolls || []),
        key: clone(this.state.maze.key),
        door: clone(this.state.maze.door),
      },
      player: clone(this.state.player),
      monster: clone(this.state.monster),
      inventory: clone(this.state.inventory),
      stats: clone(this.state.stats),
      capabilities: this._buildCapabilities(),
      viewport: viewport ? clone(viewport) : null,
      grid: rows,
    };
  }

  getUpdates(sinceRevision = 0, options = {}) {
    return this._withSession(options.sessionId, (sessionId) => {
      const since = Number(sinceRevision) || 0;
      const snapshot = this._buildSnapshot({ ...options, sessionId });
      const events = this.events.filter((event) => event.revision > since);
      return {
        since,
        currentRevision: this.revision,
        changed: this.revision > since,
        snapshot,
        events,
        message: this._getLatestEventMessage(events),
      };
    });
  }
}

module.exports = new LabyrinthService();
