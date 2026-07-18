/**
 * Greenhouse domain service — "Grow-a-Plant".
 *
 * Each identity (logged-in user or anonymous demo) owns SLOT_COUNT greenhouse
 * slots. Plant a seed into an empty slot, water it so it keeps growing, harvest
 * it when ripe. State is per-identity:
 *   • kind "user" → persisted to the store
 *   • kind "demo" → in-memory only, evicted after an idle TTL
 *
 * Unary:  listCrops / listGreenhouses / plant / water / harvest
 * Stream: subscribeGreenhouses (server streaming, one frame per tick)
 *
 * Errors carry a `.type` ("NOT_FOUND" | "INVALID_ARGUMENT" | "FAILED_PRECONDITION")
 * that handlers map to gRPC status codes — the service stays transport-agnostic.
 */
const greenhouseDb = require("./db");
const { SLOT_COUNT, CROPS, getCrop } = require("./config/crops");
const tickEngine = require("./simulator/tick-engine");
const log = require("./logger");

const DEMO_IDLE_TTL_MS = 30 * 60 * 1000;
const TICK_INTERVAL_MS = Number(process.env.GREENHOUSE_TICK_MS) || 1000;

// identityKey ("kind:id") -> { kind, id, greenhouses, harvested, lastAccess, subscribers, tick, tickTimer }
const sessions = new Map();

function serviceError(type, message) {
  return Object.assign(new Error(message), { type });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeIdentity(identity) {
  const kind = identity && identity.kind === "user" ? "user" : "demo";
  const rawId = identity && typeof identity.id === "string" && identity.id.trim() ? identity.id.trim() : null;
  const id = rawId || (kind === "user" ? "user-unknown" : "demo-anonymous");
  return { kind, id };
}

function emptyGreenhouses() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, plant: null }));
}

function sweepExpiredDemoSessions(now) {
  for (const [key, session] of sessions) {
    if (session.kind === "demo" && now - session.lastAccess > DEMO_IDLE_TTL_MS) {
      if (session.tickTimer) clearInterval(session.tickTimer);
      sessions.delete(key);
      log.debug("evicted idle demo session", { key, idle_ms: now - session.lastAccess });
    }
  }
}

async function getSession(identity) {
  const { kind, id } = normalizeIdentity(identity);
  const now = Date.now();
  sweepExpiredDemoSessions(now);

  const key = `${kind}:${id}`;
  let session = sessions.get(key);
  if (!session) {
    let greenhouses = emptyGreenhouses();
    let harvested = 0;
    if (kind === "user") {
      const persisted = await greenhouseDb.getUserState(id);
      if (persisted) {
        greenhouses = normalizeGreenhouses(persisted.greenhouses);
        harvested = persisted.harvested;
      }
    }
    session = { kind, id, greenhouses, harvested, lastAccess: now, subscribers: new Set(), tick: 0, tickTimer: null };
    sessions.set(key, session);
  } else {
    session.lastAccess = now;
  }
  return session;
}

// Ensure persisted data conforms to the current slot count / shape.
function normalizeGreenhouses(stored) {
  const base = emptyGreenhouses();
  if (Array.isArray(stored)) {
    for (const gh of stored) {
      const idx = (Number(gh?.slot) || 0) - 1;
      if (idx >= 0 && idx < base.length && gh.plant) {
        base[idx].plant = gh.plant;
      }
    }
  }
  return base;
}

async function persistIfUser(session) {
  if (session.kind === "user") {
    await greenhouseDb.saveUserState(session.id, { greenhouses: session.greenhouses, harvested: session.harvested });
  }
}

function getSlot(session, slot) {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1 || n > SLOT_COUNT) {
    throw serviceError("INVALID_ARGUMENT", `slot must be between 1 and ${SLOT_COUNT}`);
  }
  return session.greenhouses.find((g) => g.slot === n);
}

// ── Mapping to proto shapes ─────────────────────────────────────────────────

function toPlant(plant) {
  if (!plant) return null;
  const crop = getCrop(plant.crop);
  return {
    crop: plant.crop,
    crop_name: crop ? crop.name : plant.crop,
    emoji: crop ? crop.emoji : "🌱",
    growth: Math.round(plant.growth),
    stage: plant.stage || tickEngine.stageFor(plant.growth),
    water: Math.round(plant.water),
    ripe: plant.growth >= 100,
    thirsty: plant.water <= 0,
  };
}

function toGreenhouse(gh) {
  return { slot: gh.slot, occupied: !!gh.plant, plant: toPlant(gh.plant) };
}

function snapshot(session) {
  return {
    greenhouses: session.greenhouses.map(toGreenhouse),
    harvested: session.harvested,
    tick: session.tick,
  };
}

// ── Unary operations ────────────────────────────────────────────────────────

function listCrops() {
  return { crops: CROPS.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, ripe_ticks: c.ripeTicks })) };
}

async function listGreenhouses(identity) {
  const session = await getSession(identity);
  return snapshot(session);
}

async function plant(identity, slot, cropId) {
  const session = await getSession(identity);
  const gh = getSlot(session, slot);
  if (gh.plant) {
    throw serviceError("FAILED_PRECONDITION", `Slot ${gh.slot} is already occupied`);
  }
  const crop = getCrop(cropId);
  if (!crop) {
    throw serviceError("INVALID_ARGUMENT", `Unknown crop "${cropId}"`);
  }
  gh.plant = { crop: crop.id, growth: 0, water: 100, stage: "seed", ripe: false, thirsty: false };
  await persistIfUser(session);
  return toGreenhouse(gh);
}

async function water(identity, slot) {
  const session = await getSession(identity);
  const gh = getSlot(session, slot);
  if (!gh.plant) {
    throw serviceError("FAILED_PRECONDITION", `Slot ${gh.slot} is empty`);
  }
  gh.plant.water = 100;
  gh.plant.thirsty = false;
  await persistIfUser(session);
  return toGreenhouse(gh);
}

async function harvest(identity, slot) {
  const session = await getSession(identity);
  const gh = getSlot(session, slot);
  if (!gh.plant) {
    throw serviceError("FAILED_PRECONDITION", `Slot ${gh.slot} is empty`);
  }
  if (gh.plant.growth < 100) {
    throw serviceError("FAILED_PRECONDITION", `Plant in slot ${gh.slot} is not ripe yet`);
  }
  const harvestedCrop = gh.plant.crop;
  gh.plant = null;
  session.harvested += 1;
  await persistIfUser(session);
  return { greenhouse: toGreenhouse(gh), harvested_crop: harvestedCrop, harvested: session.harvested };
}

// ── Live growth (server streaming) ──────────────────────────────────────────

function tickSession(session) {
  session.tick += 1;
  for (const gh of session.greenhouses) {
    if (gh.plant) tickEngine.advancePlant(gh.plant, getCrop(gh.plant.crop));
  }
  const frame = snapshot(session);
  for (const onFrame of session.subscribers) {
    try {
      onFrame(frame);
    } catch {
      /* a failing subscriber must not break the tick loop */
    }
  }
}

function ensureTicking(session) {
  if (session.tickTimer) return;
  session.tickTimer = setInterval(() => tickSession(session), TICK_INTERVAL_MS);
  if (typeof session.tickTimer.unref === "function") session.tickTimer.unref();
  log.debug("tick loop started", { key: `${session.kind}:${session.id}`, interval_ms: TICK_INTERVAL_MS });
}

function stopTickingIfIdle(session) {
  if (session.subscribers.size === 0 && session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
    log.debug("tick loop stopped (no subscribers)", { key: `${session.kind}:${session.id}`, tick: session.tick });
  }
}

/**
 * Subscribe to the caller's live greenhouse frames. Emits an immediate snapshot,
 * then one frame per tick.
 * @returns {Promise<() => void>} unsubscribe
 */
async function subscribeGreenhouses(identity, onFrame) {
  const session = await getSession(identity);
  session.subscribers.add(onFrame);
  onFrame(snapshot(session)); // immediate snapshot
  ensureTicking(session);
  return () => {
    session.subscribers.delete(onFrame);
    stopTickingIfIdle(session);
  };
}

function resetSessions() {
  for (const session of sessions.values()) {
    if (session.tickTimer) {
      clearInterval(session.tickTimer);
      session.tickTimer = null;
    }
  }
  sessions.clear();
}

module.exports = {
  listCrops,
  listGreenhouses,
  plant,
  water,
  harvest,
  subscribeGreenhouses,
  // mapping/helpers (exported for tests)
  toGreenhouse,
  snapshot,
  SLOT_COUNT,
  TICK_INTERVAL_MS,
  _sessions: sessions,
  _resetSessions: resetSessions,
};
