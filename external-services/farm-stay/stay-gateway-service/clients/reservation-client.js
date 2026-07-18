/**
 * gRPC client → reservation-service (gateway side). Same resilience pattern as
 * the inventory client.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { RESERVATION_TARGET, RESERVATION_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS } = require("../config");

const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

let client = null;
let healthClient = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(RESERVATION_PROTO, PROTO_LOADER_OPTIONS)).reservation;
}
function getClient() {
  if (!client) client = new (loadProto().Reservation)(RESERVATION_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  return client;
}
function getHealthClient() {
  if (!healthClient) healthClient = new (loadProto().Health)(RESERVATION_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  return healthClient;
}
function reset() {
  for (const ref of [client, healthClient]) {
    if (ref)
      try {
        ref.close();
      } catch {
        /* ignore */
      }
  }
  client = null;
  healthClient = null;
}
function resetIfConnectionError(err) {
  if (err && (err.code === grpc.status.UNAVAILABLE || err.code === grpc.status.DEADLINE_EXCEEDED)) reset();
}
function metadata(userId) {
  const md = new grpc.Metadata();
  if (userId) md.set("stay-user-id", String(userId));
  return md;
}
function unary(method, request, userId) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    getClient()[method](request, metadata(userId), { deadline }, (err, reply) => {
      if (err) {
        resetIfConnectionError(err);
        return reject(err);
      }
      resolve(reply);
    });
  });
}

module.exports = {
  target: RESERVATION_TARGET,
  health: () =>
    new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
      getHealthClient().Check({}, { deadline }, (err, reply) => {
        if (err) {
          resetIfConnectionError(err);
          return reject(err);
        }
        resolve(reply);
      });
    }),
  createBooking: (userId, b) =>
    unary(
      "CreateBooking",
      {
        guest_id: b.guestId,
        property_id: b.propertyId,
        host_id: b.hostId || "",
        from: b.from,
        to: b.to,
        guests: b.guests || 1,
        lock_id: b.lockId,
        quote_total: b.quoteTotal || 0,
        hold_expires_at: b.holdExpiresAt || "",
        policy: b.policy || "moderate",
        coupon: b.coupon || "",
      },
      userId,
    ),
  confirmBooking: (userId, id, acceptedTotal) => unary("ConfirmBooking", { id, guest_id: userId, accepted_total: acceptedTotal }, userId),
  cancelBooking: (userId, id) => unary("CancelBooking", { id, user_id: userId }, userId),
  markReleaseDone: (userId, id) => unary("MarkReleaseDone", { id, user_id: userId }, userId),
  getBooking: (userId, id) => unary("GetBooking", { id, user_id: userId }, userId),
  listBookings: (userId, role) => unary("ListBookings", { user_id: userId, role: role || "any" }, userId),
  // Every booking across all users — for the admin/platform analytics view.
  listAllBookings: (userId) => unary("ListBookings", { user_id: "", role: "all" }, userId),
  _reset: reset,
};
