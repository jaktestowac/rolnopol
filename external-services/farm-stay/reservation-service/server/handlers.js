/**
 * gRPC handlers for the reservation service.
 *
 * Owns the booking record + state machine. Lazy transitions on read:
 *   - a "hold" past holdExpiresAt reads as "expired"
 *   - a "confirmed" booking past checkout reads as "completed"
 * No background timers; an injectable clock drives all time comparisons.
 */
const grpc = require("@grpc/grpc-js");
const db = require("./db");
const { now, nowIso } = require("../../shared/clock");
const { refundPct } = require("../config/policies");
const { createLogger } = require("../../shared/logger");

const log = createLogger("reservation");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

function fail(callback, code, message, method, fields) {
  log[code === grpc.status.INTERNAL ? "error" : "warn"](`${method} failed`, { ...fields, error: message });
  callback({ code, details: message });
}

function checkoutMs(to) {
  return new Date(`${to}T00:00:00Z`).getTime();
}

/** Effective (lazy) state for a stored booking. */
function effectiveState(b, nowMs) {
  if (b.state === "hold") {
    const exp = b.holdExpiresAt ? Date.parse(b.holdExpiresAt) : NaN;
    if (Number.isFinite(exp) && exp <= nowMs) return "expired";
    return "hold";
  }
  if (b.state === "confirmed" && checkoutMs(b.to) <= nowMs) return "completed";
  return b.state;
}

function toBooking(b, nowMs) {
  return {
    id: b.id,
    guest_id: b.guestId,
    property_id: b.propertyId,
    host_id: b.hostId || "",
    from: b.from,
    to: b.to,
    guests: b.guests || 1,
    state: effectiveState(b, nowMs),
    lock_id: b.lockId || "",
    quote_total: b.quoteTotal || 0,
    hold_expires_at: b.holdExpiresAt || "",
    cancelled_at: b.cancelledAt || "",
    refund_pct: b.refundPct != null ? b.refundPct : 0,
    release_status: b.releaseStatus || "",
    created_at: b.createdAt || "",
    policy: b.policy || "moderate",
    coupon: b.coupon || "",
  };
}

// ── Health ──────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const data = await db.getAll().catch(() => null);
  callback(null, {
    status: "SERVING",
    db_initialized: db.db.isInitialized === true,
    booking_count: data?.bookings?.length || 0,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
  });
}

// ── Bookings ──────────────────────────────────────────────────────────────────

async function createBooking(call, callback) {
  const r = call.request || {};
  try {
    if (!r.guest_id) return fail(callback, grpc.status.INVALID_ARGUMENT, "guest_id required", "CreateBooking");
    if (!r.property_id || !r.lock_id)
      return fail(callback, grpc.status.INVALID_ARGUMENT, "property_id and lock_id required", "CreateBooking");
    const created = await db.mutate((data) => {
      const seq = (data.seq || 0) + 1;
      const booking = {
        id: `bk-${seq}`,
        guestId: r.guest_id,
        propertyId: r.property_id,
        hostId: r.host_id || "",
        from: r.from,
        to: r.to,
        guests: r.guests || 1,
        state: "hold",
        lockId: r.lock_id,
        quoteTotal: r.quote_total || 0,
        holdExpiresAt: r.hold_expires_at || "",
        policy: r.policy || "moderate",
        coupon: r.coupon || "",
        createdAt: nowIso(),
      };
      return { next: { ...data, seq, bookings: [...data.bookings, booking] }, value: booking };
    });
    log.info("CreateBooking", { id: created.id, guest: r.guest_id, property: r.property_id });
    callback(null, toBooking(created, now()));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "CreateBooking");
  }
}

async function confirmBooking(call, callback) {
  const r = call.request || {};
  try {
    const nowMs = now();
    const result = await db.mutate((data) => {
      const idx = data.bookings.findIndex((b) => b.id === r.id);
      if (idx === -1) return { value: { error: "NOT_FOUND" } };
      const b = data.bookings[idx];
      if (r.guest_id && b.guestId !== r.guest_id) return { value: { error: "FORBIDDEN" } };
      const state = effectiveState(b, nowMs);
      if (state === "expired") return { value: { error: "HOLD_EXPIRED" } };
      if (state !== "hold") return { value: { error: "BAD_STATE", state } };
      // The gateway owns the price-change handshake and passes the authoritative
      // total the guest agreed to; the reservation records it and flips state.
      const finalTotal = r.accepted_total > 0 ? r.accepted_total : b.quoteTotal;
      const confirmed = { ...b, state: "confirmed", holdExpiresAt: "", quoteTotal: finalTotal };
      const bookings = [...data.bookings];
      bookings[idx] = confirmed;
      return { next: { ...data, bookings }, value: { booking: confirmed } };
    });
    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Booking "${r.id}" not found`, "ConfirmBooking");
    if (result.error === "FORBIDDEN") return fail(callback, grpc.status.PERMISSION_DENIED, "Not your booking", "ConfirmBooking");
    if (result.error === "HOLD_EXPIRED")
      return fail(callback, grpc.status.FAILED_PRECONDITION, "HOLD_EXPIRED", "ConfirmBooking", { id: r.id });
    if (result.error === "BAD_STATE")
      return fail(callback, grpc.status.FAILED_PRECONDITION, `Cannot confirm a ${result.state} booking`, "ConfirmBooking", { id: r.id });
    log.info("ConfirmBooking", { id: r.id });
    callback(null, toBooking(result.booking, nowMs));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "ConfirmBooking");
  }
}

async function cancelBooking(call, callback) {
  const r = call.request || {};
  try {
    const nowMs = now();
    const result = await db.mutate((data) => {
      const idx = data.bookings.findIndex((b) => b.id === r.id);
      if (idx === -1) return { value: { error: "NOT_FOUND" } };
      const b = data.bookings[idx];
      if (r.user_id && b.guestId !== r.user_id) return { value: { error: "FORBIDDEN" } };
      const state = effectiveState(b, nowMs);
      if (state === "cancelled" || state === "completed" || state === "expired") {
        return { value: { error: "BAD_STATE", state } };
      }
      const pct = refundPct(b.policy, b.from, nowMs);
      const cancelled = {
        ...b,
        state: "cancelled",
        cancelledAt: nowIso(),
        refundPct: pct,
        releaseStatus: "pending",
      };
      const bookings = [...data.bookings];
      bookings[idx] = cancelled;
      return { next: { ...data, bookings }, value: { booking: cancelled } };
    });
    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Booking "${r.id}" not found`, "CancelBooking");
    if (result.error === "FORBIDDEN") return fail(callback, grpc.status.PERMISSION_DENIED, "Not your booking", "CancelBooking");
    if (result.error === "BAD_STATE")
      return fail(callback, grpc.status.FAILED_PRECONDITION, `Cannot cancel a ${result.state} booking`, "CancelBooking", { id: r.id });
    const b = result.booking;
    log.info("CancelBooking", { id: r.id, refund_pct: b.refundPct });
    callback(null, { booking: toBooking(b, nowMs), lock_id: b.lockId || "", refund_pct: b.refundPct });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "CancelBooking");
  }
}

async function markReleaseDone(call, callback) {
  const r = call.request || {};
  try {
    const result = await db.mutate((data) => {
      const idx = data.bookings.findIndex((b) => b.id === r.id);
      if (idx === -1) return { value: { error: "NOT_FOUND" } };
      const updated = { ...data.bookings[idx], releaseStatus: "done" };
      const bookings = [...data.bookings];
      bookings[idx] = updated;
      return { next: { ...data, bookings }, value: { booking: updated } };
    });
    if (result.error === "NOT_FOUND") return fail(callback, grpc.status.NOT_FOUND, `Booking "${r.id}" not found`, "MarkReleaseDone");
    callback(null, toBooking(result.booking, now()));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "MarkReleaseDone");
  }
}

async function getBooking(call, callback) {
  const r = call.request || {};
  try {
    const data = await db.getAll();
    const b = data.bookings.find((x) => x.id === r.id);
    if (!b) return fail(callback, grpc.status.NOT_FOUND, `Booking "${r.id}" not found`, "GetBooking");
    if (r.user_id && b.guestId !== r.user_id && b.hostId !== r.user_id) {
      return fail(callback, grpc.status.PERMISSION_DENIED, "Not your booking", "GetBooking");
    }
    callback(null, toBooking(b, now()));
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "GetBooking");
  }
}

async function listBookings(call, callback) {
  const r = call.request || {};
  try {
    const nowMs = now();
    const data = await db.getAll();
    const role = r.role || "any";
    const list = data.bookings.filter((b) => {
      const isGuest = b.guestId === r.user_id;
      const isHost = b.hostId === r.user_id;
      if (role === "guest") return isGuest;
      if (role === "host") return isHost;
      return isGuest || isHost;
    });
    callback(null, { bookings: list.map((b) => toBooking(b, nowMs)), total: list.length });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "ListBookings");
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  reservation: {
    CreateBooking: createBooking,
    ConfirmBooking: confirmBooking,
    CancelBooking: cancelBooking,
    MarkReleaseDone: markReleaseDone,
    GetBooking: getBooking,
    ListBookings: listBookings,
  },
  _internals: { effectiveState },
};
