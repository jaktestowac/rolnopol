/**
 * The per-request context (PRD §4.2, §9).
 *
 * One of these is built per request and handed to every resolver. It carries the
 * three things a resolver is not allowed to reach for itself:
 *
 *   - **identity** (`userId`), taken from the authenticated session by the route.
 *     A resolver never reads `req`, so it cannot accidentally trust a header or an
 *     input field for scoping;
 *   - **the clock**, so nothing in the domain calls `Date.now()`;
 *   - **loaders**, created fresh here so batching is per-request and cannot cache
 *     across users.
 *
 * It also counts store reads. That count is reported in `extensions.storeReads`
 * and is what makes the N+1 promise testable rather than aspirational: a roster
 * query over 15 members and one over 200 must report the same number.
 */
const { createClock } = require("./clock");
const { createStaffGateway } = require("./staff-gateway");
const { createAssignmentReader } = require("./assignment-reader");
const { createAcademyGateway } = require("./academy-gateway");
const { createCrewNotifier } = require("./notifier");
const { createBatchLoader, createOnce, groupBy } = require("./loaders");
const { CrewError, CREW_ERROR_CODES } = require("./errors");

/**
 * @param {object} options
 * @param {number|string} options.userId - the authenticated caller
 * @param {Array} options.pillars - assembled pillars (see registry.js)
 * @param {Date|string|number} [options.now] - fixed clock for tests
 * @param {object} [options.academy] - AgriAcademy gateway overrides ({ client,
 *   isEnabled }) so the link's degradation paths are testable in isolation
 * @param {(event: object) => any} [options.publishNotification] - notification
 *   publisher override, so a test can assert which events a mutation emits
 *   without going through the dispatcher (see notifier.js)
 */
function createCrewContext({ userId, pillars = [], now, academy, publishNotification } = {}) {
  // Identity is coerced to a number the same way every other Rolnopol service
  // does it, because scoping compares against `Number(row.userId)`.
  //
  // A token whose userId is not numeric is tolerated rather than rejected, to
  // match the existing modules: `GET /api/v1/staff` with such a token returns an
  // empty list, so Crew Office returns an empty crew. NaN can never equal a
  // stored userId, so the failure mode is "you own nothing" — never "you can see
  // someone else's". WRITES are a different matter and are refused outright
  // (`assertWritableIdentity`), because a row stamped with NaN would serialise as
  // `null` and be unreachable forever.
  const numericUserId = Number(userId);
  const hasWritableIdentity = Number.isFinite(numericUserId);

  const storeReads = { total: 0, byStore: {} };
  const onStoreRead = (storeName) => {
    storeReads.total += 1;
    storeReads.byStore[storeName] = (storeReads.byStore[storeName] || 0) + 1;
  };

  const clock = createClock({ now });
  const staffGateway = createStaffGateway({ onStoreRead });
  const assignmentReader = createAssignmentReader({ onStoreRead });
  // The optional AgriAcademy link (§8.4). Built per request so its flag lookup and
  // certificate fetch are cached for the request and nothing else. `academy` is an
  // override seam for tests — an offline academy is a state that has to be
  // reachable without starting five standalone services.
  const academyGateway = createAcademyGateway({ onStoreRead, ...(academy || {}) });

  // Notification egress. Built with the identity above so no pillar can address a
  // notification to anyone but the authenticated owner (notifier.js, decision 1).
  const notifier = createCrewNotifier({ userId: numericUserId, publish: publishNotification });

  // Base loaders every pillar can rely on. Each is lazy: a query that never
  // mentions assignments never reads assignments.json.
  const loaders = {
    ownedStaff: createOnce(() => staffGateway.listOwned(numericUserId)),
    staffById: createBatchLoader(async () => {
      const owned = await loaders.ownedStaff.get();
      const map = new Map();
      for (const record of owned) map.set(Number(record.id), record);
      return map;
    }),
    fieldIdsByStaffId: createBatchLoader(() => assignmentReader.fieldIdsByStaffId(numericUserId)),
  };

  const context = {
    userId: numericUserId,
    hasWritableIdentity,
    /** Guard every write path with this. Reads do not need it — NaN owns nothing. */
    assertWritableIdentity() {
      if (!hasWritableIdentity) {
        throw new CrewError(
          CREW_ERROR_CODES.UNAUTHENTICATED,
          "This session has no usable account id, so nothing can be written on its behalf.",
        );
      }
    },
    clock,
    staffGateway,
    assignmentReader,
    academyGateway,
    notifier,
    loaders,
    storeReads,
    onStoreRead,
    pillars: pillars.map((pillar) => pillar.name),
    /** Pillar services, populated below — the seam pillars use to reach each other. */
    services: {},
    /** Register a per-request loader from a pillar, keeping the same laziness. */
    addLoader(name, load) {
      if (!loaders[name]) loaders[name] = createBatchLoader(load);
      return loaders[name];
    },
    /**
     * Invalidate loaders after a write, so a mutation that re-reads to report its
     * own result sees the write rather than the snapshot taken before it.
     *
     * Named explicitly rather than clearing everything, so a write only pays for
     * the reads it actually invalidated.
     */
    resetLoaders(...names) {
      for (const name of names) {
        if (typeof loaders[name]?.reset === "function") loaders[name].reset();
      }
    },
  };

  // Each pillar contributes its own service, built with this context. A pillar
  // reaching another pillar goes through `context.services.<name>` — an explicit,
  // greppable dependency rather than a require() into a sibling directory.
  for (const pillar of pillars) {
    if (typeof pillar.createService === "function") {
      context.services[pillar.name] = pillar.createService(context);
    }
  }

  return context;
}

module.exports = { createCrewContext, groupBy };
