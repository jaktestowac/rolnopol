/**
 * Which tool outcomes are worth telling somebody about, and what they say.
 *
 * Extracted for the same reason `ledger.js` is: `service.js` answers questions
 * about tools, and a fifteen-line event payload in the middle of `issueTool` made
 * it answer a question about notifications too. Everything here is pure — it
 * returns a descriptor and publishes nothing — so "which outcomes notify?" is one
 * table to read and the payloads are testable without a context.
 *
 * Keyed on `result.outcome`, so an outcome that is absent from the table is
 * silent by construction. UNAVAILABLE, REQUIRES_CERTIFICATION, CHECK_UNAVAILABLE,
 * NOT_ON_ISSUE and NOT_FOUND are all refusals: nothing happened, so there is
 * nothing to announce.
 *
 * Both events share ONE correlationId, built from the issuance rather than the
 * tool. A tool goes out many times and each trip is its own thread; keying on the
 * tool would braid every trip it ever made into one. Sharing it across the two
 * halves is what makes `GET /api/v1/notifications/events?correlationId=...` able
 * to return a trip out and back, which is how the ledger reads too.
 */
const { CREW_EVENTS } = require("../../notifier");

const tripCorrelationId = (issuance) => `crew-tool-issuance-${issuance.id}`;

const BY_OUTCOME = {
  ISSUED: (result) => ({
    type: CREW_EVENTS.TOOL_ISSUED,
    correlationId: tripCorrelationId(result.issuance),
    payload: {
      issuanceId: String(result.issuance.id),
      toolId: Number(result.issuance.toolId),
      toolName: result.tool?.name ?? null,
      staffId: Number(result.issuance.staffId),
      dueBack: result.issuance.dueBack,
      issuedAt: result.issuance.issuedAt,
    },
  }),

  RETURNED: (result) => ({
    type: CREW_EVENTS.TOOL_RETURNED,
    correlationId: tripCorrelationId(result.issuance),
    payload: {
      issuanceId: String(result.issuance.id),
      toolId: Number(result.issuance.toolId),
      toolName: result.tool?.name ?? null,
      staffId: Number(result.issuance.staffId),
      condition: result.issuance.conditionOnReturn,
      // Where the condition sent it: back on the shelf, into the workshop, or off
      // the run entirely. This is the half a reader acts on.
      toolStatus: result.tool?.status ?? null,
      late: result.late === true,
      returnedAt: result.issuance.returnedAt,
    },
  }),
};

/** The event this result should produce, or null when the outcome is silent. */
function eventFor(result) {
  const build = BY_OUTCOME[result?.outcome];
  return build ? build(result) : null;
}

module.exports = { eventFor, BY_OUTCOME };
