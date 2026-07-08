/**
 * Error mapping for the gateway.
 *
 * Two error species arrive from downstream:
 *   - gRPC errors (numeric .code) from inventory/reservation
 *   - http-client errors ({ kind: "unavailable" | "http", status, body }) from
 *     pricing/review-desk
 *
 * mapError() turns either into { status, body } for the HTTP response.
 */
const grpc = require("@grpc/grpc-js");

const GRPC_TO_HTTP = {
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.FAILED_PRECONDITION]: 409,
  [grpc.status.PERMISSION_DENIED]: 403,
  [grpc.status.UNAVAILABLE]: 503,
  [grpc.status.DEADLINE_EXCEEDED]: 503,
};

function isGrpcError(err) {
  return err && typeof err.code === "number";
}

function mapError(err) {
  if (isGrpcError(err)) {
    const status = GRPC_TO_HTTP[err.code] || 500;
    const detail = err.details || err.message || "Error";
    if (status === 503) return { status, body: { error: "SERVICE_UNAVAILABLE", detail } };
    if (status === 500) return { status, body: { error: "INTERNAL" } };
    return { status, body: { error: detail } };
  }
  if (err && err.kind === "unavailable") {
    return { status: 503, body: { error: "SERVICE_UNAVAILABLE", detail: err.message } };
  }
  if (err && err.kind === "http") {
    // Pass through 4xx from a leaf; collapse leaf 5xx to a 502-ish 503.
    if (err.status >= 400 && err.status < 500) return { status: err.status, body: err.body || { error: "Upstream error" } };
    return { status: 503, body: { error: "SERVICE_UNAVAILABLE", detail: `leaf responded ${err.status}` } };
  }
  return { status: 500, body: { error: "INTERNAL" } };
}

/** Was this a connectivity failure (leaf down/timeout) rather than a domain error? */
function isUnavailable(err) {
  if (isGrpcError(err)) return err.code === grpc.status.UNAVAILABLE || err.code === grpc.status.DEADLINE_EXCEEDED;
  return err && err.kind === "unavailable";
}

/** gRPC FAILED_PRECONDITION carrying a specific domain token in details. */
function grpcPreconditionToken(err) {
  if (isGrpcError(err) && err.code === grpc.status.FAILED_PRECONDITION) return err.details || "";
  return "";
}

function sendError(res, err) {
  const { status, body } = mapError(err);
  res.status(status).json(body);
}

module.exports = { mapError, sendError, isUnavailable, isGrpcError, grpcPreconditionToken };
