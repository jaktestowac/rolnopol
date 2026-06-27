/**
 * TaskLab module (app side) — gRPC client.
 *
 * The Rolnopol app holds no TaskLab domain logic or data; it is a thin gRPC
 * client of the standalone TaskLab service. The whole module is gated by the
 * `taskLabEnabled` feature flag and is for logged-in users only (the caller's
 * userId comes from the session auth middleware).
 */
const tasklabClient = require("./tasklab-client");

module.exports = {
  client: tasklabClient,
};
