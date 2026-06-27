/**
 * Greenhouse module (app side) — gRPC client + identity resolution.
 *
 * The Rolnopol app holds no greenhouse domain logic or data; it is a thin gRPC
 * client of the standalone greenhouse service. The whole module is gated by the
 * `greenhouseControlRoomEnabled` feature flag.
 */
const greenhouseClient = require("./greenhouse-client");
const { resolveGreenhouseIdentity, tryGetUserId } = require("./identity");

module.exports = {
  client: greenhouseClient,
  resolveGreenhouseIdentity,
  tryGetUserId,
};
