/**
 * gRPC handlers for the inventory service.
 *
 * The heart of FarmStay: listings CRUD, Search (catalog + free-dates in one
 * call), calendars, and ATOMIC date-range locking. Hold's check-and-lock runs
 * inside a single db.mutate() so two concurrent bookings for the same range
 * resolve to exactly one winner.
 */
const grpc = require("@grpc/grpc-js");
const db = require("./db");
const { DEFAULT_HOLD_TTL_SEC } = require("../config");
const { now, nowIso } = require("../../shared/clock");
const dates = require("../../shared/dates");
const { createLogger } = require("../../shared/logger");

const log = createLogger("inventory");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

const VALID_TYPES = ["room", "cottage", "camping"];
const VALID_POLICIES = ["flexible", "moderate", "strict"];

function fail(callback, code, message, method, fields) {
  log[code === grpc.status.INTERNAL ? "error" : "warn"](`${method} failed`, { ...fields, error: message });
  callback({ code, details: message });
}

function isLockActive(lock, nowMs) {
  if (lock.kind === "confirmed" || lock.kind === "blackout") return true;
  if (lock.kind === "hold") return typeof lock.expiresAt === "number" && lock.expiresAt > nowMs;
  return false;
}

function activeLocksFor(data, propertyId, nowMs) {
  const cal = data.calendars?.[propertyId];
  if (!cal || !Array.isArray(cal.locks)) return [];
  return cal.locks.filter((l) => isLockActive(l, nowMs));
}

function rangeIsFree(data, propertyId, from, to, nowMs) {
  return !activeLocksFor(data, propertyId, nowMs).some((l) => dates.rangesOverlap(from, to, l.from, l.to));
}

function toProperty(p) {
  return {
    id: p.id,
    host_id: p.hostId,
    name: p.name,
    district: p.district || "",
    type: p.type,
    capacity: p.capacity,
    base_price: p.basePrice,
    policy: p.policy,
    amenities: p.amenities || [],
    photo_ref: p.photoRef || "",
    active: !!p.active,
  };
}

// ── Health ──────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const data = await db.getAll().catch(() => null);
  callback(null, {
    status: "SERVING",
    db_initialized: db.db.isInitialized === true,
    property_count: data?.properties?.length || 0,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
  });
}

// ── Listings ──────────────────────────────────────────────────────────────────

async function listProperties(call, callback) {
  try {
    const { host_id, include_inactive } = call.request || {};
    const data = await db.getAll();
    // A host sees all their own listings (active or not). Without a host filter
    // the default is active-only (the public catalog); include_inactive lifts
    // that so the platform analytics view counts every listing ever published.
    const props = data.properties.filter((p) => (host_id ? p.hostId === host_id : p.active || include_inactive));
    callback(null, { properties: props.map(toProperty), total: props.length });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "ListProperties");
  }
}

async function createProperty(call, callback) {
  const r = call.request || {};
  try {
    if (!r.host_id) return fail(callback, grpc.status.INVALID_ARGUMENT, "host_id is required", "CreateProperty");
    if (!r.name || !r.name.trim()) return fail(callback, grpc.status.INVALID_ARGUMENT, "name is required", "CreateProperty");
    if (!VALID_TYPES.includes(r.type))
      return fail(callback, grpc.status.INVALID_ARGUMENT, `type must be one of ${VALID_TYPES.join(", ")}`, "CreateProperty");
    if (!(r.capacity > 0)) return fail(callback, grpc.status.INVALID_ARGUMENT, "capacity must be > 0", "CreateProperty");
    if (!(r.base_price >= 0)) return fail(callback, grpc.status.INVALID_ARGUMENT, "base_price must be >= 0", "CreateProperty");
    const policy = VALID_POLICIES.includes(r.policy) ? r.policy : "moderate";

    const created = await db.mutate((data) => {
      const seq = (data.seq || 0) + 1;
      const property = {
        id: `prop-${seq}`,
        hostId: r.host_id,
        name: r.name.trim(),
        district: r.district || "",
        type: r.type,
        capacity: r.capacity,
        basePrice: r.base_price,
        policy,
        amenities: Array.isArray(r.amenities) ? r.amenities : [],
        photoRef: r.photo_ref || "",
        active: true,
      };
      const next = {
        ...data,
        seq,
        properties: [...data.properties, property],
        calendars: { ...data.calendars, [property.id]: { locks: [] } },
      };
      return { next, value: property };
    });
    log.info("CreateProperty", { id: created.id, host: r.host_id });
    callback(null, toProperty(created));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "CreateProperty");
  }
}

async function updateProperty(call, callback) {
  const r = call.request || {};
  try {
    const result = await db.mutate((data) => {
      const idx = data.properties.findIndex((p) => p.id === r.id);
      if (idx === -1) return { value: { error: "NOT_FOUND" } };
      const existing = data.properties[idx];
      if (existing.hostId !== r.host_id) return { value: { error: "FORBIDDEN" } };
      const updated = {
        ...existing,
        name: r.name && r.name.trim() ? r.name.trim() : existing.name,
        capacity: r.capacity > 0 ? r.capacity : existing.capacity,
        basePrice: r.base_price >= 0 ? r.base_price : existing.basePrice,
        policy: VALID_POLICIES.includes(r.policy) ? r.policy : existing.policy,
        active: typeof r.active === "boolean" ? r.active : existing.active,
      };
      const properties = [...data.properties];
      properties[idx] = updated;
      return { next: { ...data, properties }, value: { property: updated } };
    });
    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Property "${r.id}" not found`, "UpdateProperty");
    if (result.error === "FORBIDDEN") return fail(callback, grpc.status.PERMISSION_DENIED, "Not your property", "UpdateProperty");
    callback(null, toProperty(result.property));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "UpdateProperty");
  }
}

async function deleteProperty(call, callback) {
  const r = call.request || {};
  try {
    const nowMs = now();
    const result = await db.mutate((data) => {
      const property = data.properties.find((p) => p.id === r.id);
      if (!property) return { value: { error: "NOT_FOUND" } };
      if (property.hostId !== r.host_id) return { value: { error: "FORBIDDEN" } };
      // "Occupied" = the calendar has an active hold or a current/future
      // confirmed stay. Past (checked-out) confirmed locks and host blackouts
      // do NOT block deletion.
      const cal = data.calendars?.[r.id];
      const occupied = (cal?.locks || []).some(
        (l) => (l.kind === "hold" && isLockActive(l, nowMs)) || (l.kind === "confirmed" && l.to > new Date(nowMs).toISOString().slice(0, 10)),
      );
      if (occupied) return { value: { error: "OCCUPIED" } };

      const properties = data.properties.filter((p) => p.id !== r.id);
      const calendars = { ...data.calendars };
      delete calendars[r.id];
      return { next: { ...data, properties, calendars }, value: { deleted: true } };
    });
    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Property "${r.id}" not found`, "DeleteProperty");
    if (result.error === "FORBIDDEN") return fail(callback, grpc.status.PERMISSION_DENIED, "Not your property", "DeleteProperty");
    if (result.error === "OCCUPIED")
      return fail(callback, grpc.status.FAILED_PRECONDITION, "OCCUPIED", "DeleteProperty", { id: r.id });
    log.info("DeleteProperty", { id: r.id, host: r.host_id });
    callback(null, { id: r.id, deleted: true });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "DeleteProperty");
  }
}

// ── Search + calendar ──────────────────────────────────────────────────────────

async function search(call, callback) {
  const r = call.request || {};
  try {
    if (!dates.isValidRange(r.from, r.to))
      return fail(callback, grpc.status.INVALID_ARGUMENT, "from/to must be valid dates with from < to", "Search");
    const nowMs = now();
    const data = await db.getAll();
    const guests = r.guests > 0 ? r.guests : 1;
    const matches = data.properties.filter((p) => {
      if (!p.active) return false;
      if (r.exclude_host_id && p.hostId === r.exclude_host_id) return false;
      if (r.district && p.district !== r.district) return false;
      if (r.type && p.type !== r.type) return false;
      if (p.capacity < guests) return false;
      if (r.max_price && r.max_price > 0 && p.basePrice > r.max_price) return false;
      return rangeIsFree(data, p.id, r.from, r.to, nowMs);
    });
    log.info("Search", { from: r.from, to: r.to, guests, results: matches.length });
    callback(null, { properties: matches.map(toProperty), total: matches.length });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "Search");
  }
}

async function getCalendar(call, callback) {
  const r = call.request || {};
  try {
    if (!dates.isValidRange(r.from, r.to))
      return fail(callback, grpc.status.INVALID_ARGUMENT, "from/to must be valid dates with from < to", "GetCalendar");
    const nowMs = now();
    const data = await db.getAll();
    if (!data.properties.some((p) => p.id === r.property_id))
      return fail(callback, grpc.status.NOT_FOUND, `Property "${r.property_id}" not found`, "GetCalendar");
    const locks = activeLocksFor(data, r.property_id, nowMs);
    const days = dates.eachNight(r.from, r.to).map((date) => {
      // A night is the half-open range [date, date+1); available if no active lock overlaps it.
      const available = !locks.some((l) => dates.rangesOverlap(date, addDay(date), l.from, l.to));
      return { date, available };
    });
    callback(null, { property_id: r.property_id, days });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "GetCalendar");
  }
}

function addDay(date) {
  const t = new Date(`${date}T00:00:00Z`).getTime() + 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// ── Locking (atomic) ──────────────────────────────────────────────────────────

async function hold(call, callback) {
  const r = call.request || {};
  const kind = r.kind === "blackout" ? "blackout" : "hold";
  try {
    if (!dates.isValidRange(r.from, r.to))
      return fail(callback, grpc.status.INVALID_ARGUMENT, "from/to must be valid dates with from < to", "Hold");
    const ttlSec = kind === "hold" ? (r.ttl_sec > 0 ? r.ttl_sec : DEFAULT_HOLD_TTL_SEC) : 0;
    const nowMs = now();

    const result = await db.mutate((data) => {
      const property = data.properties.find((p) => p.id === r.property_id);
      if (!property) return { value: { error: "NOT_FOUND" } };
      if (kind === "blackout" && property.hostId !== r.host_id) return { value: { error: "FORBIDDEN" } };
      if (!rangeIsFree(data, r.property_id, r.from, r.to, nowMs)) {
        const active = activeLocksFor(data, r.property_id, nowMs)
          .filter((l) => dates.rangesOverlap(r.from, r.to, l.from, l.to))
          .sort((a, b) => (a.to < b.to ? -1 : 1));
        return { value: { error: "UNAVAILABLE", nextFreeFrom: active.length ? active[active.length - 1].to : "" } };
      }
      const seq = (data.seq || 0) + 1;
      const lock = {
        lockId: `lock-${seq}`,
        from: r.from,
        to: r.to,
        kind,
        expiresAt: kind === "hold" ? nowMs + ttlSec * 1000 : undefined,
      };
      const cal = data.calendars[r.property_id] || { locks: [] };
      const calendars = {
        ...data.calendars,
        [r.property_id]: { locks: [...pruneExpired(cal.locks, nowMs), lock] },
      };
      return { next: { ...data, seq, calendars }, value: { lock } };
    });

    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Property "${r.property_id}" not found`, "Hold");
    if (result.error === "FORBIDDEN") return fail(callback, grpc.status.PERMISSION_DENIED, "Not your property", "Hold");
    if (result.error === "UNAVAILABLE")
      return fail(callback, grpc.status.FAILED_PRECONDITION, "RANGE_UNAVAILABLE", "Hold", {
        property: r.property_id,
        from: r.from,
        to: r.to,
      });

    const lock = result.lock;
    log.info("Hold", { property: r.property_id, lock: lock.lockId, kind, from: r.from, to: r.to });
    callback(null, {
      lock_id: lock.lockId,
      expires_at: lock.expiresAt ? new Date(lock.expiresAt).toISOString() : "",
      next_free_from: "",
    });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "Hold");
  }
}

function pruneExpired(locks, nowMs) {
  return locks.filter((l) => isLockActive(l, nowMs));
}

async function confirmHold(call, callback) {
  const r = call.request || {};
  try {
    const nowMs = now();
    const result = await db.mutate((data) => {
      for (const [propId, cal] of Object.entries(data.calendars || {})) {
        const idx = (cal.locks || []).findIndex((l) => l.lockId === r.lock_id);
        if (idx === -1) continue;
        const lock = cal.locks[idx];
        if (lock.kind === "hold" && !(typeof lock.expiresAt === "number" && lock.expiresAt > nowMs)) {
          return { value: { error: "EXPIRED" } };
        }
        const confirmed = { ...lock, kind: "confirmed", expiresAt: undefined };
        const locks = [...cal.locks];
        locks[idx] = confirmed;
        return { next: { ...data, calendars: { ...data.calendars, [propId]: { ...cal, locks } } }, value: { lock: confirmed } };
      }
      return { value: { error: "NOT_FOUND" } };
    });
    if (result.error === "NOT_FOUND" || result.error === "EXPIRED")
      return fail(callback, grpc.status.NOT_FOUND, `Lock "${r.lock_id}" not found or expired`, "ConfirmHold");
    log.info("ConfirmHold", { lock: r.lock_id });
    callback(null, { lock_id: r.lock_id, kind: "confirmed", ok: true });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "ConfirmHold");
  }
}

async function release(call, callback) {
  const r = call.request || {};
  try {
    // Idempotent: releasing an absent lock is OK (makes the gateway cancel-retry safe).
    await db.mutate((data) => {
      let changed = false;
      const calendars = {};
      for (const [propId, cal] of Object.entries(data.calendars || {})) {
        const locks = (cal.locks || []).filter((l) => l.lockId !== r.lock_id);
        if (locks.length !== (cal.locks || []).length) changed = true;
        calendars[propId] = { ...cal, locks };
      }
      return changed ? { next: { ...data, calendars }, value: { released: true } } : { value: { released: false } };
    });
    log.info("Release", { lock: r.lock_id });
    callback(null, { lock_id: r.lock_id, kind: "released", ok: true });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "Release");
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  inventory: {
    ListProperties: listProperties,
    CreateProperty: createProperty,
    UpdateProperty: updateProperty,
    DeleteProperty: deleteProperty,
    Search: search,
    GetCalendar: getCalendar,
    Hold: hold,
    ConfirmHold: confirmHold,
    Release: release,
  },
  // exported for unit tests
  _internals: { isLockActive, rangeIsFree },
};
