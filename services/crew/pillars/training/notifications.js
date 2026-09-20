/**
 * Which training outcomes are worth telling somebody about.
 *
 * Same split as `tools/notifications.js`, and the same rule: keyed on
 * `result.outcome`, so NOT_FOUND, ALREADY_REVOKED and VALIDATION_FAILED are
 * silent by construction — nothing was revoked, so there is nothing to say.
 *
 * REVOKED is the one outcome in this pillar that changes what a member is
 * ALLOWED to do rather than what is recorded about them: the tools gate is
 * fail-closed against a revoked certificate from that moment on (§8.5). The
 * payload therefore carries the resulting gap COUNT rather than the gap list —
 * enough to know something needs looking at, not a report in a bell icon.
 *
 * `courseName` is resolved by the caller and passed in, because the certification
 * row carries only a `courseId` and this file does no I/O. "Chainsaw Operation
 * was revoked" is the message; "certificate 12 was revoked" is not worth sending.
 */
const { CREW_EVENTS } = require("../../notifier");

const BY_OUTCOME = {
  REVOKED: (result, { courseName = null } = {}) => ({
    type: CREW_EVENTS.CERTIFICATION_REVOKED,
    correlationId: `crew-certification-revoked-${result.certification.id}`,
    payload: {
      certificationId: String(result.certification.id),
      staffId: Number(result.certification.staffId),
      courseId: Number(result.certification.courseId),
      courseName,
      reason: result.certification.revokedReason,
      revokedOn: result.certification.revokedOn,
      gapCount: Array.isArray(result.gaps) ? result.gaps.length : 0,
    },
  }),
};

/** The event this result should produce, or null when the outcome is silent. */
function eventFor(result, extras = {}) {
  const build = BY_OUTCOME[result?.outcome];
  return build ? build(result, extras) : null;
}

module.exports = { eventFor, BY_OUTCOME };
