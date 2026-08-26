/**
 * Which profile writes are worth telling somebody about.
 *
 * Only one, and it is not keyed on an outcome: `recordEmploymentEnd` has no
 * union — it returns the updated row and THROWS on every refusal, so reaching
 * the call site at all is the success condition.
 *
 * `upsertProfile` is deliberately absent. Correcting somebody's contracted hours
 * is data entry, and an event per field edit is the drift this table exists to
 * make visible rather than easy.
 *
 * Ending employment is NOT a firing (see the note at the top of schema.graphql) —
 * it writes an end date to the overlay and leaves the staff record and its
 * assignments intact. That is exactly why it needs announcing: nothing else
 * downstream changes shape, so without this there is no signal at all.
 */
const { CREW_EVENTS } = require("../../notifier");

function employmentEnded(profile) {
  return {
    type: CREW_EVENTS.EMPLOYMENT_ENDED,
    correlationId: `crew-employment-ended-${Number(profile.staffId)}`,
    payload: {
      staffId: Number(profile.staffId),
      lastDay: profile.endDate,
      reason: profile.endReason,
    },
  };
}

module.exports = { employmentEnded };
