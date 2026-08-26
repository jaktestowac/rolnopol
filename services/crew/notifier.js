/**
 * The ONLY code in this module that publishes notification events.
 *
 * Same shape of rule as `staff-gateway.js`: one file, one narrow surface, so a
 * future "let's notify on this too" cannot be added in six places at once. A
 * pillar reaches it through `context.notifier`, which is as greppable as
 * `context.services.<name>`.
 *
 * Four decisions live here.
 *
 *   1. **`userId` is stamped here, never taken from the caller.** The dispatcher
 *      resolves a notification's recipient as
 *      `payload.userId || payload.toUserId || payload.buyerId || payload.staffId`
 *      (notification-dispatcher.js). Crew payloads all carry a `staffId`, and a
 *      staff id is NOT an account id — so a payload that reached the dispatcher
 *      without `userId` would silently address the notification to whichever
 *      account happens to share that number. The owner's id comes from the
 *      context, which took it from the authenticated session, and it overwrites
 *      anything a caller put there.
 *
 *   2. **Fire-and-forget, and it swallows everything.** A notification that
 *      fails must never turn a successful mutation into a GraphQL error: the
 *      leave IS approved, the tool IS issued, the store already says so. This
 *      mirrors what the other services do via `publishNotificationEvent`.
 *
 *   3. **Emission is gated by the route, not re-checked here.** Every crew
 *      mutation is behind `requireFeatureFlag("crewOfficeEnabled")` on both
 *      `crew.route.js` and `crew-graphql.route.js`, so a resolver cannot run
 *      with the module off and there is no event to suppress. Re-reading the
 *      flag per publish would buy nothing and add an await plus a failure mode
 *      to a path that must not be able to fail. `notificationCenterEnabled` is
 *      the notification module's own business and it checks that itself.
 *
 *   4. **Crew events are in-app only** — see the block comment above the crew
 *      policies in `core/policies.js`. That is a policy decision, enforced
 *      there rather than here, so this file has no opinion about channels.
 *
 * The `publish` override is the test seam, in the same spirit as `academy` in
 * context.js: asserting which events a mutation emits should cost a function
 * call, not a round trip through the dispatcher and its timers.
 */
const { publishNotificationEvent } = require("../../helpers/notification-publisher");
const { EVENT_TYPES } = require("../../modules/notification-center/core/contracts");

/**
 * The crew module's event vocabulary — and the whole reason the require above is
 * the ONLY one of its kind in `services/crew/`.
 *
 * Pillars name an event as `CREW_EVENTS.TOOL_ISSUED`, which is a sibling import
 * inside the module, instead of reaching four directories up into
 * notification-center's `core/contracts` for `EVENT_TYPES.CREW_TOOL_ISSUED`. The
 * strings are identical; what changes is how many files know that
 * notification-center exists, where its files live, and what its constants are
 * called. Same rule as `staff-gateway.js` and `staff.json`: one file reaches out,
 * everything else goes through it, so moving or renaming the thing on the other
 * side is a one-file edit.
 *
 * Written as an explicit mapping rather than derived by filtering EVENT_TYPES for
 * a `crew.` prefix, because this codebase asks dependencies to be greppable
 * (context.js, on `context.services.<name>`) — a reader who lands on
 * `CREW_EVENTS.TOOL_ISSUED` can find this line. A misspelt right-hand side is
 * `undefined` rather than a plausible-looking string, and `crew.notifier.test.js`
 * fails on it either way: it asserts every entry resolves AND that every `crew.*`
 * type in EVENT_TYPES appears here, so adding a seventh event without exposing it
 * is caught too.
 */
const CREW_EVENTS = Object.freeze({
  LEAVE_APPROVED: EVENT_TYPES.CREW_LEAVE_APPROVED,
  LEAVE_REJECTED: EVENT_TYPES.CREW_LEAVE_REJECTED,
  EMPLOYMENT_ENDED: EVENT_TYPES.CREW_EMPLOYMENT_ENDED,
  CERTIFICATION_REVOKED: EVENT_TYPES.CREW_CERTIFICATION_REVOKED,
  TOOL_ISSUED: EVENT_TYPES.CREW_TOOL_ISSUED,
  TOOL_RETURNED: EVENT_TYPES.CREW_TOOL_RETURNED,
});

/**
 * @param {object} options
 * @param {number} options.userId - the authenticated owner, already coerced
 * @param {(event: object) => any} [options.publish] - publisher override for tests
 */
function createCrewNotifier({ userId, publish } = {}) {
  const deliver =
    typeof publish === "function"
      ? publish
      : (event) =>
          publishNotificationEvent(event, {
            action: "crew_office_notification",
            meta: { eventType: event?.type },
          });

  return {
    /**
     * @param {string} type - a `crew.*` value from EVENT_TYPES
     * @param {object} payload - event-specific fields; `userId` is added here
     * @param {object} [options]
     * @param {string} [options.correlationId] - defaults to the event type alone,
     *   which is only right for events that carry no subject id of their own.
     *   Pass one built from the subject so a burst of unrelated writes does not
     *   look like one conversation.
     */
    publish(type, payload = {}, { correlationId } = {}) {
      try {
        deliver({
          type,
          payload: { ...payload, userId },
          correlationId: correlationId || type,
          source: "crew-office",
        });
      } catch {
        // Decision 2: a mutation that succeeded stays succeeded.
      }
    },
  };
}

module.exports = { createCrewNotifier, CREW_EVENTS };
