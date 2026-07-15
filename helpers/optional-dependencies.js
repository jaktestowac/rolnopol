/**
 * Dependencies whose absence must NOT abort application startup.
 *
 * The Greenhouse/TaskLab gRPC integration degrades gracefully when these
 * packages are missing (routes fall back to empty stubs, the WS bridge is
 * disabled), so both the startup dependency check in `api/index.js` and the
 * startup health check in `helpers/healthcheck.js` only warn about them.
 *
 * This module must stay dependency-free: `api/index.js` loads it before the
 * dependency check runs, i.e. before anything else is guaranteed installed.
 */
const OPTIONAL_STARTUP_DEPENDENCIES = new Set(["@grpc/grpc-js", "@grpc/proto-loader"]);

module.exports = { OPTIONAL_STARTUP_DEPENDENCIES };
