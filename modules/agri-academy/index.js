/**
 * AgriAcademy module (app side) — thin HTTP clients of the standalone AgriAcademy
 * gateways. The Rolnopol app holds no AgriAcademy domain logic or data. The whole
 * module is gated by the `agriAcademyEnabled` feature flag and is for logged-in
 * users only (the caller's userId comes from the session auth middleware), except
 * the public unit pages which are flag-gated but unauthenticated.
 *
 *   examCenter — taker plane (take exams, public unit pages)
 *   authoring  — authoring plane (certification units + exam/question authoring)
 */
const examCenterClient = require("./exam-center-client");
const authoringClient = require("./authoring-client");

module.exports = {
  examCenter: examCenterClient,
  authoring: authoringClient,
};
