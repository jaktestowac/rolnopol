import { describe, it, expect } from "vitest";

// The notification egress (services/crew/notifier.js).
//
// Three things are held down here:
//
//   1. a crew notification can only ever be addressed to the authenticated
//      owner, because the dispatcher would otherwise fall back to `staffId`;
//   2. a failed publish cannot turn a committed mutation into an error;
//   3. CREW_EVENTS and notification-center's EVENT_TYPES agree in both
//      directions.
//
// This file is deliberately the ONLY test in the crew suite that requires
// notification-center. Everywhere else names events through CREW_EVENTS, which
// is the same rule the pillars follow — so if that module moves, this is the
// test that fails, and it is supposed to.
const { createCrewNotifier, CREW_EVENTS } = require("../../services/crew/notifier");
const { EVENT_TYPES } = require("../../modules/notification-center/core/contracts");
const policies = require("../../modules/notification-center/core/policies");

const capture = (userId = 1) => {
  const published = [];
  return { published, notifier: createCrewNotifier({ userId, publish: (event) => published.push(event) }) };
};

describe("crew notifier", () => {
  it("stamps the owner's userId onto every payload", () => {
    const { published, notifier } = capture(42);
    notifier.publish(EVENT_TYPES.CREW_TOOL_ISSUED, { toolId: 1, staffId: 7 });

    expect(published[0].payload).toMatchObject({ userId: 42, toolId: 1, staffId: 7 });
  });

  it("OVERWRITES a userId supplied by the caller", () => {
    // The dispatcher resolves the recipient from the payload. If a caller could
    // set userId, a crew mutation could address a notification to any account.
    const { published, notifier } = capture(42);
    notifier.publish(EVENT_TYPES.CREW_TOOL_ISSUED, { userId: 999, staffId: 7 });

    expect(published[0].payload.userId).toBe(42);
  });

  it("never lets a staffId stand in for the recipient", () => {
    // notification-dispatcher.js resolves
    // `payload.userId || payload.toUserId || payload.buyerId || payload.staffId`,
    // so a payload that arrived without userId would address the notification to
    // whichever account happens to share the staff id's number.
    const { published, notifier } = capture(42);
    notifier.publish(EVENT_TYPES.CREW_LEAVE_APPROVED, { staffId: 7 });

    expect(published[0].payload.userId).toBe(42);
    expect(published[0].payload.userId).not.toBe(published[0].payload.staffId);
  });

  it("stamps the crew-office source", () => {
    const { published, notifier } = capture();
    notifier.publish(EVENT_TYPES.CREW_LEAVE_REJECTED, {});
    expect(published[0].source).toBe("crew-office");
  });

  it("falls back to the event type as the correlationId", () => {
    const { published, notifier } = capture();
    notifier.publish(EVENT_TYPES.CREW_LEAVE_REJECTED, {});
    expect(published[0].correlationId).toBe(EVENT_TYPES.CREW_LEAVE_REJECTED);
  });

  it("uses a supplied correlationId", () => {
    const { published, notifier } = capture();
    notifier.publish(EVENT_TYPES.CREW_LEAVE_REJECTED, {}, { correlationId: "crew-leave-9-rejected" });
    expect(published[0].correlationId).toBe("crew-leave-9-rejected");
  });

  it("swallows a publisher that throws — a committed mutation stays committed", () => {
    const notifier = createCrewNotifier({
      userId: 1,
      publish: () => {
        throw new Error("notification store is on fire");
      },
    });

    expect(() => notifier.publish(EVENT_TYPES.CREW_TOOL_RETURNED, { toolId: 1 })).not.toThrow();
  });

  describe("the CREW_EVENTS vocabulary", () => {
    // The pillars name events through CREW_EVENTS so that notifier.js stays the
    // only file in services/crew/ that knows notification-center exists. That
    // indirection is only safe while the two sides agree, which is what these
    // two assertions are for — one per direction of drift.

    it("resolves every entry to a real event type", () => {
      // A misspelt right-hand side in the mapping is `undefined`, which would
      // publish an event with no type and no policy behind it.
      const declared = new Set(Object.values(EVENT_TYPES));
      for (const [name, type] of Object.entries(CREW_EVENTS)) {
        expect(type, name).toBeTypeOf("string");
        expect(declared.has(type), `${name} -> ${type}`).toBe(true);
      }
    });

    it("exposes every crew event type there is", () => {
      // The other direction: a seventh crew event added to contracts.js but not
      // surfaced here would be unreachable from the pillars, which would send
      // whoever needs it straight back to the deep import this mapping exists to
      // remove.
      const fromContracts = Object.values(EVENT_TYPES).filter((type) => type.startsWith("crew."));
      expect([...Object.values(CREW_EVENTS)].sort()).toEqual([...fromContracts].sort());
    });

    it("has a policy behind every entry", () => {
      for (const [name, type] of Object.entries(CREW_EVENTS)) {
        expect(policies[type], name).toBeTruthy();
      }
    });
  });

  it("routes every crew event to in-app only", () => {
    // crew.route.js refuses personal API keys and waits on crew:read/crew:write
    // scopes. The webhook catalog has no such gate, so a crew event on the
    // webhook channel would be an egress the module deliberately kept shut.
    const crewTypes = Object.values(EVENT_TYPES).filter((type) => type.startsWith("crew."));
    expect(crewTypes.length).toBeGreaterThan(0);

    for (const type of crewTypes) {
      expect(policies[type].channels, type).toEqual(["in-app"]);
    }
  });
});
