/**
 * Service monitor — health probing for the app's external dependencies.
 *
 * The app depends on standalone services it doesn't own (today: the Greenhouse
 * and TaskLab gRPC services). This module probes each one and returns a
 * normalized status so the backend monitoring page can render a dashboard.
 *
 * Designed to be extended in two independent directions:
 *   • New service  → add one entry to SERVICES.
 *   • New transport → add one adapter (a factory returning a `probe()` that
 *                     resolves to a normalized result). Adapters own all
 *                     transport-specific concerns (dialing, error mapping); the
 *                     registry and the route stay transport-agnostic.
 *
 * A probe never throws — it resolves to one of:
 *   { status: "online",  health, error: null }
 *   { status: "offline", health: null, error }   // reachable failure (down)
 *   { status: "error",   health: null, error }   // unexpected failure
 */
const grpc = require("@grpc/grpc-js");
const featureFlagsService = require("./feature-flags.service");
const { client: greenhouseClient } = require("../modules/greenhouse");
const { client: tasklabClient } = require("../modules/tasklab");
const { CLIENT_TARGET: GREENHOUSE_TARGET } = require("../external-services/greenhouse/greenhouse-config");
const { CLIENT_TARGET: TASKLAB_TARGET } = require("../external-services/tasklab/tasklab-config");

// ── Adapters ─────────────────────────────────────────────────────────────────
// Each adapter is a factory: given transport-specific config it returns an async
// `probe()` resolving to { status, target, health, error, hint }.

/**
 * gRPC adapter — calls a client's promise-returning `health()` (a Health.Check
 * RPC). UNAVAILABLE / DEADLINE_EXCEEDED mean the service is simply down;
 * anything else is an unexpected error.
 */
function grpcHealthAdapter({ client, target, startCommand }) {
  return async () => {
    try {
      const health = await client.health();
      return { status: "online", target, health, error: null, hint: null };
    } catch (err) {
      const down = err?.code === grpc.status.UNAVAILABLE || err?.code === grpc.status.DEADLINE_EXCEEDED;
      return {
        status: down ? "offline" : "error",
        target,
        health: null,
        error: err?.details || err?.message || "Unknown error",
        hint: startCommand ? `Start it with: ${startCommand}` : null,
      };
    }
  };
}

/**
 * HTTP adapter — placeholder for the not-only-gRPC future. A service exposing a
 * JSON `/health` endpoint can be monitored by adding an entry that uses this.
 * Left commented to document the extension shape without shipping unused code.
 *
 *   function httpHealthAdapter({ url, timeoutMs = 3000 }) {
 *     return async () => {
 *       try {
 *         const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
 *         const health = await res.json().catch(() => ({}));
 *         return { status: res.ok ? "online" : "error", target: url, health, error: res.ok ? null : `HTTP ${res.status}`, hint: null };
 *       } catch (err) {
 *         return { status: "offline", target: url, health: null, error: err?.message || "Unreachable", hint: null };
 *       }
 *     };
 *   }
 */

// ── Registry ─────────────────────────────────────────────────────────────────
// Identity + transport metadata for each monitored service. `probe` is the only
// behavioral field; everything else is display/context.

const SERVICES = [
  {
    key: "greenhouse",
    name: "Greenhouse",
    description: "Grow-a-Plant gRPC service",
    transport: "gRPC",
    flag: "greenhouseControlRoomEnabled",
    probe: grpcHealthAdapter({
      client: greenhouseClient,
      target: GREENHOUSE_TARGET,
      startCommand: "npm run greenhouse",
    }),
  },
  {
    key: "tasklab",
    name: "TaskLab",
    description: "Per-user task gRPC service",
    transport: "gRPC",
    flag: "taskLabEnabled",
    probe: grpcHealthAdapter({
      client: tasklabClient,
      target: TASKLAB_TARGET,
      startCommand: "npm run tasklab",
    }),
  },
];

/**
 * Probe every registered service in parallel and merge each result with its
 * registry metadata + current feature-flag state. Feature flags are best-effort
 * context: if they can't be read, services are still reported (flagEnabled:null).
 * @returns {Promise<Array>} one normalized record per service.
 */
async function probeAll() {
  let flags = null;
  try {
    flags = (await featureFlagsService.getFeatureFlags())?.flags || {};
  } catch {
    /* flags are context only; a failure here must not hide health */
  }

  return Promise.all(
    SERVICES.map(async ({ probe, flag, ...meta }) => {
      const result = await probe();
      return {
        ...meta,
        flag,
        flagEnabled: flags ? flags[flag] === true : null,
        ...result,
      };
    }),
  );
}

module.exports = {
  probeAll,
  // Exposed for tests / future programmatic use.
  grpcHealthAdapter,
  SERVICES,
};
