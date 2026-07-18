/**
 * FarmStay module (app side) — thin HTTP client of the standalone FarmStay
 * gateway. The Rolnopol app holds no FarmStay domain logic or data. The whole
 * module is gated by the `farmStayEnabled` feature flag and is for logged-in
 * users only (the caller's userId comes from the session auth middleware).
 */
const farmStayClient = require("./farm-stay-client");

module.exports = {
  client: farmStayClient,
};
