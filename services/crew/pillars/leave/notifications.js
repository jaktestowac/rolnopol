/**
 * Which leave decisions are worth telling somebody about.
 *
 * The odd one out among the pillars: `decide` returns `outcome: "DECIDED"` for
 * every state it reaches, so the table is keyed on the request's resulting
 * STATUS rather than on the outcome. Keying on the outcome would announce all
 * four terminal states as one.
 *
 * `withdrawn` and `cancelled` are deliberately absent. Both are the caller
 * calling off their own request, and notifying somebody that they did the thing
 * they just did is the noise this module does not send. `approved` and
 * `rejected` are decisions ABOUT a request; the other two are the requester
 * changing their mind.
 *
 * The correlationId includes the status, unlike the tools pillar where issue and
 * return deliberately share one. A trip out and back is one thread; an approval
 * and a later cancellation are two separate decisions that happen to concern the
 * same request, and collapsing them would make the second look like a duplicate
 * of the first — which, now that the dedupe window is enforced, it would be.
 */
const { CREW_EVENTS } = require("../../notifier");

const BY_STATUS = {
  approved: (request) => ({
    type: CREW_EVENTS.LEAVE_APPROVED,
    correlationId: `crew-leave-${request.id}-${request.status}`,
    payload: basePayload(request),
  }),

  rejected: (request) => ({
    type: CREW_EVENTS.LEAVE_REJECTED,
    correlationId: `crew-leave-${request.id}-${request.status}`,
    payload: basePayload(request),
  }),
};

function basePayload(request) {
  return {
    requestId: String(request.id),
    staffId: Number(request.staffId),
    leaveType: request.type,
    from: request.from,
    to: request.to,
    workingDays: Number(request.workingDays),
    reason: request.reason ?? null,
    decidedAt: request.decidedAt,
  };
}

/** The event this decision should produce, or null when the status is silent. */
function eventFor(request) {
  const build = BY_STATUS[request?.status];
  return build ? build(request) : null;
}

module.exports = { eventFor, BY_STATUS };
