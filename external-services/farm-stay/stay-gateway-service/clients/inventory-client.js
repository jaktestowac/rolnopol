/**
 * gRPC client → inventory-service (app/gateway side).
 *
 * Lazily dials INVENTORY_TARGET, attaches the caller's id as "stay-user-id"
 * metadata, and exposes promise-returning unary calls. Caps reconnect backoff
 * and drops the channel on a connection error so a freshly (re)started service
 * is picked up without restarting the gateway — the same resilience TaskLab uses.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { INVENTORY_TARGET, INVENTORY_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS } = require("../config");

const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

let client = null;
let healthClient = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(INVENTORY_PROTO, PROTO_LOADER_OPTIONS)).inventory;
}

function getClient() {
  if (!client) client = new (loadProto().Inventory)(INVENTORY_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  return client;
}
function getHealthClient() {
  if (!healthClient) healthClient = new (loadProto().Health)(INVENTORY_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
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
  target: INVENTORY_TARGET,
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
  listProperties: (userId, hostId) => unary("ListProperties", { host_id: hostId || "" }, userId),
  createProperty: (userId, p) =>
    unary(
      "CreateProperty",
      {
        host_id: p.hostId,
        name: p.name || "",
        district: p.district || "",
        type: p.type || "",
        capacity: p.capacity || 0,
        base_price: p.basePrice || 0,
        policy: p.policy || "",
        amenities: Array.isArray(p.amenities) ? p.amenities : [],
        photo_ref: p.photoRef || "",
      },
      userId,
    ),
  updateProperty: (userId, id, hostId, patch) =>
    unary(
      "UpdateProperty",
      {
        id,
        host_id: hostId,
        name: patch.name || "",
        capacity: patch.capacity || 0,
        base_price: patch.basePrice || 0,
        policy: patch.policy || "",
        active: typeof patch.active === "boolean" ? patch.active : true,
      },
      userId,
    ),
  search: (userId, q) =>
    unary(
      "Search",
      {
        from: q.from,
        to: q.to,
        guests: q.guests || 1,
        district: q.district || "",
        type: q.type || "",
        max_price: q.maxPrice || 0,
        exclude_host_id: q.excludeHostId || "",
      },
      userId,
    ),
  getCalendar: (userId, propertyId, from, to) => unary("GetCalendar", { property_id: propertyId, from, to }, userId),
  hold: (userId, req) =>
    unary(
      "Hold",
      {
        property_id: req.propertyId,
        from: req.from,
        to: req.to,
        ttl_sec: req.ttlSec || 0,
        kind: req.kind || "hold",
        host_id: req.hostId || "",
      },
      userId,
    ),
  confirmHold: (userId, lockId) => unary("ConfirmHold", { lock_id: lockId }, userId),
  release: (userId, lockId) => unary("Release", { lock_id: lockId }, userId),
  _reset: reset,
};
