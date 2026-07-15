/**
 * gRPC handlers for the greenhouse service ("Grow-a-Plant").
 *
 * Handlers are thin: translate wire messages into greenhouse.service calls,
 * extract caller identity from gRPC metadata, and map domain errors to gRPC
 * status codes.
 */
const grpc = require("@grpc/grpc-js");
const greenhouseService = require("./greenhouse.service");
const { CROPS } = require("./config/crops");
const log = require("./logger");

const SERVICE_VERSION = "0.2.0";
const startedAt = Date.now();

const STATUS_BY_TYPE = {
  NOT_FOUND: grpc.status.NOT_FOUND,
  INVALID_ARGUMENT: grpc.status.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpc.status.FAILED_PRECONDITION,
};

function fail(callback, error, method, fields) {
  const code = STATUS_BY_TYPE[error?.type] || grpc.status.INTERNAL;
  const isInternal = code === grpc.status.INTERNAL;
  log[isInternal ? "error" : "warn"](`${method} failed`, {
    ...fields,
    type: error?.type || "INTERNAL",
    error: error?.message,
    stack: isInternal ? error?.stack : undefined,
  });
  callback({ code, details: error?.message || "Internal error" });
}

// Short label for the caller, for log correlation. Avoids logging raw ids at info.
function callerLabel(identity) {
  if (!identity) return "demo:anonymous";
  return `${identity.kind}:${identity.id}`;
}

/**
 * Caller identity from gRPC metadata (gh-identity, gh-identity-kind).
 * undefined when absent → service normalizes to a shared demo identity.
 */
function identityFromCall(call) {
  const md = call?.metadata;
  if (!md || typeof md.get !== "function") return undefined;
  const id = md.get("gh-identity")[0];
  if (!id) return undefined;
  const kind = md.get("gh-identity-kind")[0] === "user" ? "user" : "demo";
  return { kind, id: String(id) };
}

// ── Health ──────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const dbInitialized = require("./db").db.isInitialized === true;
  log.debug("Health.Check", { db_initialized: dbInitialized, uptime_ms: Date.now() - startedAt });
  callback(null, {
    status: "SERVING",
    db_initialized: dbInitialized,
    crop_count: CROPS.length,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
  });
}

// ── GreenhouseControl — unary ─────────────────────────────────────────────────

function listCrops(call, callback) {
  log.debug("ListCrops", { count: CROPS.length });
  callback(null, greenhouseService.listCrops());
}

async function listGreenhouses(call, callback) {
  const identity = identityFromCall(call);
  try {
    const result = await greenhouseService.listGreenhouses(identity);
    log.info("ListGreenhouses", { caller: callerLabel(identity), harvested: result.harvested, tick: result.tick });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "ListGreenhouses", { caller: callerLabel(identity) });
  }
}

async function plant(call, callback) {
  const identity = identityFromCall(call);
  const { slot, crop } = call.request || {};
  try {
    const result = await greenhouseService.plant(identity, slot, crop);
    log.info("Plant", { caller: callerLabel(identity), slot, crop });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "Plant", { caller: callerLabel(identity), slot, crop });
  }
}

async function water(call, callback) {
  const identity = identityFromCall(call);
  const slot = call.request?.slot;
  try {
    const result = await greenhouseService.water(identity, slot);
    log.info("Water", { caller: callerLabel(identity), slot });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "Water", { caller: callerLabel(identity), slot });
  }
}

async function harvest(call, callback) {
  const identity = identityFromCall(call);
  const slot = call.request?.slot;
  try {
    const result = await greenhouseService.harvest(identity, slot);
    log.info("Harvest", { caller: callerLabel(identity), slot, crop: result.harvested_crop, harvested: result.harvested });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "Harvest", { caller: callerLabel(identity), slot });
  }
}

// ── GreenhouseControl — server streaming ──────────────────────────────────────

async function watchGreenhouses(call) {
  const identity = identityFromCall(call);
  const caller = callerLabel(identity);
  let unsubscribe = null;
  let closed = false;
  let frames = 0;

  const cleanup = (reason) => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    log.info("WatchGreenhouses closed", { caller, reason, frames });
  };

  call.on("cancelled", () => cleanup("cancelled"));
  call.on("close", () => cleanup("close"));
  call.on("error", () => cleanup("error"));

  try {
    log.info("WatchGreenhouses opened", { caller });
    unsubscribe = await greenhouseService.subscribeGreenhouses(identity, (frame) => {
      if (!closed) {
        try {
          call.write(frame);
          frames += 1;
        } catch (writeErr) {
          log.warn("WatchGreenhouses write failed", { caller, error: writeErr.message });
          cleanup("write-error");
        }
      }
    });
    if (closed) cleanup("closed-before-subscribe");
  } catch (error) {
    const code = STATUS_BY_TYPE[error?.type] || grpc.status.INTERNAL;
    log.error("WatchGreenhouses failed", { caller, type: error?.type || "INTERNAL", error: error?.message });
    call.emit("error", { code, details: error?.message || "Internal error" });
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  greenhouseControl: {
    ListCrops: listCrops,
    ListGreenhouses: listGreenhouses,
    Plant: plant,
    Water: water,
    Harvest: harvest,
    WatchGreenhouses: watchGreenhouses,
  },
};
