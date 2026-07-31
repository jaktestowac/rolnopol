import { describe, test, expect } from "vitest";
import fc from "fast-check";

// The issuance-ledger invariant (PRD §14.3).
//
// **The derived current holder ≡ a replay of the append-only ledger, for any random
// issue/return sequence.**
//
// Why this is worth a property test rather than a handful of examples. §8.5 says the
// current holder is never stored, and `ledger.js` therefore carries TWO
// implementations of "who has it":
//
//   - `currentHolderId` — find the row that has not been closed. Cheap, and what
//     every query and every page actually uses;
//   - `replayLedger` — expand each row into an ISSUE and (when closed) a RETURN
//     event, order the events by their timestamps, and fold. Slower, and structurally
//     unlike the first: it answers "what does the history say happened?" rather than
//     "which row looks open?".
//
// Neither is the specification; their AGREEMENT is. A single implementation would
// make the claim unfalsifiable, and a claim you cannot falsify is not tested. The
// failure this guards against is quiet and permanent: the ledger is append-only, so a
// row written wrongly is a row that is wrong for good.
//
// Three properties below, in increasing strength:
//
//   1. the two implementations agree over a ledger built by a pure model;
//   2. the real SERVICE never produces a ledger where they disagree — model-based,
//      so it also checks the service's own answers against an independent model of
//      the domain rules;
//   3. a ledger with two open rows for one tool is ALWAYS flagged. This one exists to
//      prove properties 1 and 2 can fail, which is the thing that makes them mean
//      something.
const {
  currentHolderId,
  currentIssuance,
  replayLedger,
  effectiveStatus,
  openIssuances,
  STATUS_AFTER_RETURN,
  RETURN_CONDITIONS,
} = require("../../services/crew/pillars/tools/ledger");
const { createToolsService } = require("../../services/crew/pillars/tools/service");
const { DEFAULT_DATA } = require("../../services/crew/pillars/tools/store");
const { CrewError, CREW_ERROR_CODES } = require("../../services/crew/errors");

const TODAY = "2026-07-30";
const NOW_ISO = "2026-07-30T09:00:00.000Z";
const USER_ID = 1;
const STAFF_IDS = [3, 4, 5];

const clone = (value) => JSON.parse(JSON.stringify(value));

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * One operation on a tool.
 *
 * `issue` is weighted heaviest by repetition in `constantFrom` — a sequence that is
 * mostly retirements never gets a ledger long enough to be interesting.
 *
 * `tickBefore` is the reason the timestamps below are not simply monotonic. Every
 * test in this module runs on a FIXED clock, so in practice a return and the next
 * issue share an instant, and the fold's correctness rests entirely on its tie-break.
 * A generator that always advanced the clock would test the easy case exclusively —
 * and the tie-break bug this caught during development was invisible until two events
 * shared a timestamp.
 */
const operationArb = fc.record({
  kind: fc.constantFrom("issue", "issue", "issue", "issue", "return", "return", "return", "service", "retire"),
  toolIndex: fc.nat({ max: 2 }),
  staffIndex: fc.nat({ max: STAFF_IDS.length - 1 }),
  condition: fc.constantFrom(...RETURN_CONDITIONS),
  dueInDays: fc.nat({ max: 30 }),
  tickBefore: fc.boolean(),
});

const sequenceArb = fc.array(operationArb, { minLength: 1, maxLength: 30 });

/**
 * An independent model of the domain rules, with no store and no service in it.
 *
 * Deliberately written from §8.5's prose rather than by reading `service.js`, so that
 * a change to the service which breaks a rule shows up as a disagreement rather than
 * being mirrored into the model.
 */
function createModel(toolCount) {
  const state = new Map();
  for (let index = 0; index < toolCount; index += 1) state.set(index, { holder: null, admin: "available" });

  return {
    state,
    /** What SHOULD happen, per the rules. Returns an expected outcome name. */
    apply(operation) {
      const tool = state.get(operation.toolIndex);
      const staffId = STAFF_IDS[operation.staffIndex];

      if (operation.kind === "issue") {
        if (tool.holder !== null) return "UNAVAILABLE:ON_ISSUE";
        if (tool.admin === "retired") return "UNAVAILABLE:RETIRED";
        if (tool.admin === "in_service") return "UNAVAILABLE:IN_SERVICE";
        tool.holder = staffId;
        return "ISSUED";
      }

      if (operation.kind === "return") {
        if (tool.holder === null) return "NOT_ON_ISSUE";
        tool.holder = null;
        tool.admin = STATUS_AFTER_RETURN[operation.condition];
        return "RETURNED";
      }

      if (operation.kind === "service") {
        if (tool.holder !== null) return "NOT_SERVICEABLE:ON_ISSUE";
        if (tool.admin === "retired") return "NOT_SERVICEABLE:RETIRED";
        tool.admin = "available";
        return "SERVICED";
      }

      // retire
      if (tool.admin === "retired") return "ALREADY_RETIRED";
      if (tool.holder !== null) return "ON_ISSUE";
      tool.admin = "retired";
      return "RETIRED";
    },
  };
}

/**
 * Build a ledger from an operation sequence, purely — no store, no service.
 *
 * The timestamp is MONOTONIC: it never goes backwards, and `tickBefore` only decides
 * whether it advances or stays put. That is not a convenience, it is what makes the
 * generated ledger legal. A builder whose timestamps could go backwards would produce
 * a history in which a tool was issued before the previous holder returned it, and
 * the replay would rightly flag it — failing the property for the fixture's sins
 * rather than the code's. (This is not hypothetical: the first version of this file
 * did exactly that.)
 *
 * @param {Array} operations
 * @param {object} [options]
 * @param {boolean} [options.alwaysTick] - advance on every event, ignoring `tickBefore`
 */
function buildLedger(operations, { alwaysTick = false } = {}) {
  const model = createModel(3);
  const issuances = [];
  let nextId = 0;
  let minute = 0;

  for (const operation of operations) {
    if (alwaysTick || operation.tickBefore) minute += 1;
    const at = new Date(Date.UTC(2026, 6, 30, 6, minute)).toISOString();
    const toolId = operation.toolIndex + 1;
    const expected = model.apply(operation);

    if (expected === "ISSUED") {
      nextId += 1;
      issuances.push({
        id: nextId,
        userId: USER_ID,
        toolId,
        staffId: STAFF_IDS[operation.staffIndex],
        issuedAt: at,
        dueBack: addDays(TODAY, operation.dueInDays),
        returnedAt: null,
        conditionOnReturn: null,
      });
      continue;
    }

    if (expected === "RETURNED") {
      const open = issuances.find((row) => row.toolId === toolId && row.returnedAt === null);
      open.returnedAt = at;
      open.conditionOnReturn = operation.condition;
    }
    // Everything else changes no ledger row, which is itself part of the claim: a
    // refused issue must not append.
  }

  return { issuances, model };
}

// --- property 1: the two implementations agree ------------------------------

describe("derived holder ≡ ledger replay", () => {
  test("agrees for any legal issue/return sequence, with no fold violations", () => {
    fc.assert(
      fc.property(sequenceArb, (operations) => {
        const { issuances, model } = buildLedger(operations);

        for (const [index, tool] of model.state.entries()) {
          const toolId = index + 1;
          const derived = currentHolderId(issuances, toolId);
          const replay = replayLedger(issuances, toolId);

          // The invariant.
          expect(replay.holder).toBe(derived);
          // And the fold is clean, which is the part that says the ledger itself is legal.
          expect(replay.violations).toEqual([]);
          // Both agree with an independent model of the rules.
          expect(derived).toBe(tool.holder);
        }

        // At most one open row per tool, restated directly — it is the structural
        // fact the whole invariant rests on.
        const openByTool = new Map();
        for (const row of openIssuances(issuances)) {
          openByTool.set(row.toolId, (openByTool.get(row.toolId) || 0) + 1);
        }
        for (const count of openByTool.values()) expect(count).toBe(1);
      }),
      { numRuns: 300 },
    );
  });

  test("the open row and the fold name the same issuance, not merely the same person", () => {
    // A stronger form: two consecutive issues to the SAME member would satisfy an
    // equality on holder alone while pointing at different rows.
    fc.assert(
      fc.property(sequenceArb, (operations) => {
        // Every event on its own instant here, so this property is about identity
        // rather than about the tie-break — property 1 already covers the ties.
        const { issuances } = buildLedger(operations, { alwaysTick: true });

        for (let index = 0; index < 3; index += 1) {
          const toolId = index + 1;
          const open = currentIssuance(issuances, toolId);
          const replay = replayLedger(issuances, toolId);
          expect(replay.issuanceId).toBe(open === null ? null : Number(open.id));
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --- property 2: the service never produces a ledger that disagrees ---------

function makeStoreDouble() {
  let data = clone(DEFAULT_DATA);
  return {
    async getAll() {
      return clone(data);
    },
    async update(mutate) {
      data = mutate(clone(data));
      return data;
    },
    snapshot: () => clone(data),
  };
}

function makeContext(store) {
  const loaders = {};
  const makeLoader = (load) => {
    let promise = null;
    return {
      all: () => (promise = promise || load()),
      get: async (key) => (await (promise = promise || load())).get(key),
      reset: () => {
        promise = null;
      },
    };
  };

  const staff = STAFF_IDS.map((id) => ({ id, userId: USER_ID, name: `Member ${id}`, surname: "Test", age: 30 }));
  const staffById = new Map(staff.map((record) => [record.id, record]));

  const context = {
    userId: USER_ID,
    hasWritableIdentity: true,
    assertWritableIdentity() {},
    clock: { today: () => TODAY, nowIso: () => NOW_ISO },
    pillars: ["profiles", "tools"],
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead() {},
    loaders: { ownedStaff: { get: async () => staff }, staffById: makeLoader(async () => staffById) },
    addLoader(name, load) {
      if (!loaders[name]) loaders[name] = makeLoader(load);
      return loaders[name];
    },
    resetLoaders(...names) {
      for (const name of names) loaders[name]?.reset();
    },
  };

  context.services.profiles = {
    async findMember(staffId) {
      const record = staffById.get(Number(staffId)) || null;
      return record ? { staffId: Number(staffId), staff: record, profile: null } : null;
    },
    async listCrew() {
      return staff.map((record) => ({ staffId: record.id, staff: record, profile: null }));
    },
  };

  // Nothing in this file is about the certification gate — `crew.tools.test.js`
  // owns that — so the tools here require no certification and the training pillar
  // is simply absent.
  const service = createToolsService(context, { store });
  context.services.tools = service;
  return { context, service };
}

describe("the tools service upholds the ledger invariant", () => {
  test("never produces a ledger where the derived holder and the replay disagree", async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (operations) => {
        const store = makeStoreDouble();
        const { service } = makeContext(store);

        const toolIds = [];
        for (const tag of ["CHS-001", "DRL-002", "SHV-007"]) {
          const registered = await service.registerTool({ assetTag: tag, name: tag, serviceIntervalDays: 180, lastServicedOn: TODAY });
          expect(registered.outcome).toBe("REGISTERED");
          toolIds.push(registered.tool.id);
        }

        const model = createModel(toolIds.length);
        // The append-only claim, checked as the sequence runs rather than only at the
        // end: a row that was rewritten halfway through and rewritten back would pass
        // a final-state check.
        let seen = [];

        for (const operation of operations) {
          const toolId = toolIds[operation.toolIndex];
          const staffId = STAFF_IDS[operation.staffIndex];
          const expected = model.apply(operation);

          let result;
          if (operation.kind === "issue") {
            result = await service.issueTool({ toolId, staffId, dueBack: addDays(TODAY, operation.dueInDays) });
            expect(outcomeName(result)).toBe(expected);
          } else if (operation.kind === "return") {
            result = await service.returnTool({ toolId, condition: operation.condition });
            expect(outcomeName(result)).toBe(expected);
          } else if (operation.kind === "service") {
            result = await service.recordService({ toolId });
            expect(outcomeName(result)).toBe(expected);
          } else {
            result = await service.retireTool({ toolId, reason: "property test" });
            expect(outcomeName(result)).toBe(expected);
          }

          const ledger = store.snapshot().issuances;

          // Append-only (§6.6): every row previously seen is still there, and its
          // ISSUE facts are untouched. `returnedAt` may go from null to a value once,
          // which is the single in-place completion the ledger allows.
          for (const before of seen) {
            const now = ledger.find((row) => row.id === before.id);
            expect(now).toBeDefined();
            expect(now.toolId).toBe(before.toolId);
            expect(now.staffId).toBe(before.staffId);
            expect(now.issuedAt).toBe(before.issuedAt);
            expect(now.dueBack).toBe(before.dueBack);
            if (before.returnedAt !== null) expect(now.returnedAt).toBe(before.returnedAt);
          }
          expect(ledger.length).toBeGreaterThanOrEqual(seen.length);
          seen = clone(ledger);
        }

        // The invariant, per tool, against both the replay and the model.
        const finalLedger = store.snapshot().issuances;
        const finalTools = store.snapshot().tools;

        for (const [index, expectedState] of model.state.entries()) {
          const toolId = toolIds[index];
          const derived = currentHolderId(finalLedger, toolId);
          const replay = replayLedger(finalLedger, toolId);

          expect(replay.holder).toBe(derived);
          expect(replay.violations).toEqual([]);
          expect(derived).toBe(expectedState.holder);

          // And rule 1 of `service.js`: the tool row never learned who had it.
          const row = finalTools.find((tool) => tool.id === toolId);
          expect(row).not.toHaveProperty("heldBy");
          expect(row.status).toBe(expectedState.admin);
          expect(effectiveStatus(row, finalLedger)).toBe(expectedState.holder === null ? expectedState.admin : "on_issue");
        }
      }),
      { numRuns: 60 },
    );
  });
});

/** The service's outcome, in the vocabulary the model speaks. */
function outcomeName(result) {
  if (result.outcome === "UNAVAILABLE") return `UNAVAILABLE:${result.reason}`;
  if (result.outcome === "NOT_SERVICEABLE") return `NOT_SERVICEABLE:${String(result.status).toUpperCase()}`;
  return result.outcome;
}

// --- property 3: the invariant can fail -------------------------------------

describe("the fold flags an illegal ledger", () => {
  test("always reports a second open row for one tool", () => {
    // Without this, properties 1 and 2 could be passing because `replayLedger` never
    // reports anything. This is the double-issue bug's exact shape, injected on
    // purpose: two open rows for one tool must ALWAYS be flagged, whatever the
    // timestamps or the members involved.
    fc.assert(
      fc.property(
        fc.record({
          firstStaff: fc.constantFrom(...STAFF_IDS),
          secondStaff: fc.constantFrom(...STAFF_IDS),
          sameInstant: fc.boolean(),
          extraClosedRows: fc.nat({ max: 4 }),
        }),
        ({ firstStaff, secondStaff, sameInstant, extraClosedRows }) => {
          const ledger = [];
          let id = 0;

          // Some legal history first, so the violation is not the only thing in the fold.
          for (let index = 0; index < extraClosedRows; index += 1) {
            id += 1;
            ledger.push({
              id,
              userId: USER_ID,
              toolId: 1,
              staffId: STAFF_IDS[index % STAFF_IDS.length],
              issuedAt: new Date(Date.UTC(2026, 6, 1, index * 2)).toISOString(),
              dueBack: TODAY,
              returnedAt: new Date(Date.UTC(2026, 6, 1, index * 2 + 1)).toISOString(),
              conditionOnReturn: "good",
            });
          }

          const first = new Date(Date.UTC(2026, 6, 20, 6)).toISOString();
          const second = sameInstant ? first : new Date(Date.UTC(2026, 6, 21, 6)).toISOString();
          ledger.push(
            { id: id + 1, userId: USER_ID, toolId: 1, staffId: firstStaff, issuedAt: first, dueBack: TODAY, returnedAt: null },
            { id: id + 2, userId: USER_ID, toolId: 1, staffId: secondStaff, issuedAt: second, dueBack: TODAY, returnedAt: null },
          );

          const replay = replayLedger(ledger, 1);
          expect(replay.violations.length).toBeGreaterThan(0);
          expect(replay.violations.some((violation) => violation.kind === "ISSUED_WHILE_HELD")).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("reports a return of a tool nobody was holding", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STAFF_IDS), (staffId) => {
        // Returned before it was issued — the shape a rewritten row would leave.
        const ledger = [
          {
            id: 1,
            userId: USER_ID,
            toolId: 1,
            staffId,
            issuedAt: new Date(Date.UTC(2026, 6, 21, 6)).toISOString(),
            dueBack: TODAY,
            returnedAt: new Date(Date.UTC(2026, 6, 20, 6)).toISOString(),
            conditionOnReturn: "good",
          },
        ];
        expect(replayLedger(ledger, 1).violations).toEqual([{ kind: "RETURNED_WHILE_FREE", issuanceId: 1 }]);
      }),
      { numRuns: 20 },
    );
  });
});

// A guard against this file quietly testing nothing, in the same spirit as
// property 3: the imports it relies on have to actually be there.
describe("the module under test is the real one", () => {
  test("exposes both implementations and the domain vocabulary", () => {
    expect(typeof currentHolderId).toBe("function");
    expect(typeof replayLedger).toBe("function");
    expect(RETURN_CONDITIONS).toEqual(["good", "damaged", "needs_service", "lost"]);
    expect(STATUS_AFTER_RETURN.lost).toBe("retired");
    expect(CrewError).toBeDefined();
    expect(CREW_ERROR_CODES.VERSION_CONFLICT).toBe("VERSION_CONFLICT");
  });
});
