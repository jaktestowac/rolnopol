import { describe, it, expect } from "vitest";

// Tools pillar (PRD §14.1, §8.5).
//
// The four things Phase 6 names:
//
//   1. **Double-issue refused** — two concurrent `issueTool` calls for one tool must
//      produce exactly one `ToolIssued`. Driven here at the service layer, where the
//      lock actually is; the HTTP version lives in `tests/crew-leave-race.test.js`.
//   2. **Return then reissue** — a returned tool goes out again, and a tool returned
//      DAMAGED or NEEDS_SERVICE does not until somebody services it.
//   3. **Service-status boundaries** — due today is not late; due yesterday is. And a
//      tool with an interval but no service history is `overdue`, not `ok`.
//   4. **`CertificationCheckUnavailable` when the check cannot be evaluated —
//      FAIL-CLOSED, never fail-open.** This is the one that matters, and it is
//      tested as a property of the whole gate rather than branch by branch: there is
//      a sweep at the end asserting that nothing but a positive answer ever issues.
//
// Plus the ledger's central claim — the holder is DERIVED — and retire semantics.
//
// Driven at the pure-function and service layers with an in-memory store double, for
// the same reason as the training pillar: the interesting cases are dense and a round
// trip each would make the sweep too expensive to keep.
const {
  currentIssuance,
  currentHolderId,
  replayLedger,
  nextServiceDue,
  serviceStatus,
  daysUntilService,
  isOverdueBack,
  daysUntilDueBack,
  wasReturnedLate,
  effectiveStatus,
  openIssuances,
  overdueIssuances,
  ledgerFor,
  DUE_SOON_DAYS,
  TOOL_CATEGORIES,
  RETURN_CONDITIONS,
  STATUS_AFTER_RETURN,
} = require("../../services/crew/pillars/tools/ledger");
const {
  createToolsService,
  validateToolInput,
  validateIssueInput,
  validateReturnInput,
  validateRetireInput,
  normaliseCategory,
  normaliseInterval,
  MAX_LOAN_DAYS,
} = require("../../services/crew/pillars/tools/service");
const { DEFAULT_DATA } = require("../../services/crew/pillars/tools/store");
const { certificationCheck, toFailureReason, issueOutcome } = require("../../services/crew/pillars/tools/resolvers");
const { CREW_ERROR_CODES, CrewError } = require("../../services/crew/errors");
const { createCrewNotifier, CREW_EVENTS } = require("../../services/crew/notifier");

const TODAY = "2026-07-30";
const NOW_ISO = "2026-07-30T09:00:00.000Z";
const USER_ID = 1;

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// --- the pure core ----------------------------------------------------------

describe("the derived holder (§8.5) — decision 1", () => {
  const T = "2026-07-20T06:00:00.000Z";
  const row = (id, staffId, returnedAt = null, toolId = 1) => ({ id, toolId, staffId, issuedAt: T, returnedAt, dueBack: TODAY });

  it("reads the holder off the open row, and null once it is closed", () => {
    expect(currentHolderId([row(1, 3)], 1)).toBe(3);
    expect(currentHolderId([row(1, 3, "2026-07-21T16:00:00.000Z")], 1)).toBeNull();
  });

  it("keeps tools apart — a ledger holds every tool's rows in one list", () => {
    const ledger = [row(1, 3, null, 1), row(2, 4, null, 2)];
    expect(currentHolderId(ledger, 1)).toBe(3);
    expect(currentHolderId(ledger, 2)).toBe(4);
    expect(currentHolderId(ledger, 3)).toBeNull();
  });

  it("returns rows for one tool in append order", () => {
    const ledger = [row(3, 4, null, 1), row(1, 3, "x", 1), row(2, 5, "y", 2)];
    expect(ledgerFor(ledger, 1).map((r) => r.id)).toEqual([1, 3]);
  });

  it("agrees with a replay of the ledger — the two implementations of decision 1", () => {
    // The whole point of having both. `crew-tools-ledger.pbt.test.js` makes this a
    // property over random sequences; here it is stated once so a reader can see the
    // claim without running fast-check.
    // Out and back twice, then out again — each issue after the previous return,
    // which is the only sequence a legal ledger can hold.
    const ledger = [
      { ...row(1, 3, "2026-07-21T10:00:00.000Z"), issuedAt: "2026-07-20T06:00:00.000Z" },
      { ...row(2, 4, "2026-07-23T10:00:00.000Z"), issuedAt: "2026-07-22T06:00:00.000Z" },
      { ...row(3, 5), issuedAt: "2026-07-24T06:00:00.000Z" },
    ];
    expect(replayLedger(ledger, 1)).toMatchObject({ holder: 5, issuanceId: 3, violations: [] });
    expect(currentHolderId(ledger, 1)).toBe(5);
  });

  it("orders a return before the next issue when a fixed clock stamps both the same", () => {
    // Every test in this module runs on a fixed clock, so this is the ordinary case
    // rather than a corner: row 1 comes back and row 2 goes out in the same instant.
    // The fold must not read that as issuing a tool somebody is still holding.
    const ledger = [row(1, 3, NOW_ISO), { ...row(2, 4), issuedAt: NOW_ISO }];
    expect(replayLedger(ledger, 1)).toMatchObject({ holder: 4, violations: [] });
  });

  it("REPORTS a ledger with two open rows for one tool rather than resolving it quietly", () => {
    // The shape the double-issue bug would leave behind. The naive derivation picks
    // the latest open row — which is the useful answer for a page — but the replay
    // flags it, which is what makes the property test able to fail.
    const ledger = [row(1, 3), row(2, 4)];
    const replay = replayLedger(ledger, 1);
    expect(replay.violations).toEqual([{ kind: "ISSUED_WHILE_HELD", issuanceId: 2, heldBy: 3 }]);
    expect(currentHolderId(ledger, 1)).toBe(4);
  });

  it("reports a return of a tool nobody held", () => {
    const ledger = [{ ...row(1, 3, "2026-07-21T10:00:00.000Z"), issuedAt: "2026-07-22T10:00:00.000Z" }];
    expect(replayLedger(ledger, 1).violations).toEqual([{ kind: "RETURNED_WHILE_FREE", issuanceId: 1 }]);
  });

  it("is empty for a tool with no ledger at all", () => {
    expect(replayLedger([], 1)).toMatchObject({ holder: null, violations: [], events: 0 });
    expect(currentIssuance([], 1)).toBeNull();
  });
});

describe("serviceStatus — the boundaries Phase 6 names", () => {
  const tool = (serviceIntervalDays, lastServicedOn) => ({ id: 1, serviceIntervalDays, lastServicedOn });

  it("walks ok → due_soon → overdue in one sweep", () => {
    // Stated together so a change to the comparison cannot pass by satisfying one
    // case and breaking another. `nextServiceDue` is the LAST day service may be
    // done without being late, exactly like a certificate's expiry date.
    const interval = 180;
    const dueOn = (day) => tool(interval, addDays(day, -interval));

    expect(serviceStatus(dueOn(addDays(TODAY, DUE_SOON_DAYS + 1)), TODAY)).toBe("ok");
    expect(serviceStatus(dueOn(addDays(TODAY, DUE_SOON_DAYS)), TODAY)).toBe("due_soon");
    expect(serviceStatus(dueOn(TODAY), TODAY)).toBe("due_soon");
    expect(serviceStatus(dueOn(addDays(TODAY, -1)), TODAY)).toBe("overdue");
  });

  it("is DUE_SOON on the due date itself — a service is not late on the day it is due", () => {
    expect(serviceStatus(tool(90, addDays(TODAY, -90)), TODAY)).toBe("due_soon");
    expect(daysUntilService(tool(90, addDays(TODAY, -90)), TODAY)).toBe(0);
  });

  it("is OVERDUE the day after", () => {
    expect(serviceStatus(tool(90, addDays(TODAY, -91)), TODAY)).toBe("overdue");
    expect(daysUntilService(tool(90, addDays(TODAY, -91)), TODAY)).toBe(-1);
  });

  it("is OVERDUE for a tool with an interval and NO service history — decision 4", () => {
    // "We do not know when this was last serviced" must not render as "fine". A
    // fall-arrest harness whose inspection nobody recorded is the case that matters.
    expect(serviceStatus(tool(365, null), TODAY)).toBe("overdue");
    expect(serviceStatus(tool(365, undefined), TODAY)).toBe("overdue");
    expect(nextServiceDue(tool(365, null))).toBeNull();
  });

  it("is OVERDUE for a service date it cannot parse, rather than OK", () => {
    // Same unknown, different cause. Both refuse to report OK.
    expect(serviceStatus(tool(365, "2026-7-1"), TODAY)).toBe("overdue");
  });

  it("is OK forever when there is no service interval — decision 5", () => {
    // A spade is never due anything. Treating a missing interval as zero would mark
    // every hand tool overdue on the day it was registered.
    for (const interval of [null, undefined, 0, -1]) {
      expect(serviceStatus(tool(interval, null), TODAY)).toBe("ok");
      expect(nextServiceDue(tool(interval, TODAY))).toBeNull();
      expect(daysUntilService(tool(interval, TODAY), TODAY)).toBeNull();
    }
  });

  it("honours a caller's own notice window", () => {
    const due = tool(180, addDays(addDays(TODAY, 20), -180));
    expect(serviceStatus(due, TODAY)).toBe("ok");
    expect(serviceStatus(due, TODAY, { dueSoonDays: 30 })).toBe("due_soon");
  });

  it("computes the due date by adding the interval to the last service", () => {
    expect(nextServiceDue(tool(180, "2026-04-02"))).toBe("2026-09-29");
    expect(nextServiceDue(tool(1, "2026-02-28"))).toBe("2026-03-01");
  });
});

describe("isOverdueBack — decision 3", () => {
  const open = (dueBack) => ({ id: 1, toolId: 1, staffId: 3, issuedAt: NOW_ISO, dueBack, returnedAt: null });

  it("is not overdue ON the due date, and is overdue the day after", () => {
    expect(isOverdueBack(open(TODAY), TODAY)).toBe(false);
    expect(isOverdueBack(open(addDays(TODAY, -1)), TODAY)).toBe(true);
    expect(isOverdueBack(open(addDays(TODAY, 1)), TODAY)).toBe(false);
  });

  it("counts the days, negative once late", () => {
    expect(daysUntilDueBack(open(TODAY), TODAY)).toBe(0);
    expect(daysUntilDueBack(open(addDays(TODAY, -3)), TODAY)).toBe(-3);
    expect(daysUntilDueBack(open(addDays(TODAY, 5)), TODAY)).toBe(5);
  });

  it("is never true for a CLOSED row — history is not a live alarm", () => {
    const closed = { ...open(addDays(TODAY, -10)), returnedAt: NOW_ISO };
    expect(isOverdueBack(closed, TODAY)).toBe(false);
    // Whether it came back late is a separate, historical question.
    expect(wasReturnedLate(closed)).toBe(true);
  });

  it("distinguishes a late return from a punctual one", () => {
    const dueBack = "2026-07-25";
    expect(wasReturnedLate({ dueBack, returnedAt: "2026-07-26T08:00:00.000Z" })).toBe(true);
    // Back ON the due date is punctual, all day.
    expect(wasReturnedLate({ dueBack, returnedAt: "2026-07-25T23:59:00.000Z" })).toBe(false);
    expect(wasReturnedLate({ dueBack, returnedAt: null })).toBe(false);
  });

  it("sorts overdue returns most overdue first", () => {
    const ledger = [open(addDays(TODAY, -1)), { ...open(addDays(TODAY, -9)), id: 2 }, { ...open(addDays(TODAY, 4)), id: 3 }];
    expect(overdueIssuances(ledger, TODAY).map((row) => row.id)).toEqual([2, 1]);
    expect(openIssuances(ledger)).toHaveLength(3);
  });
});

describe("effectiveStatus — possession wins", () => {
  const tool = (status) => ({ id: 1, status });
  const held = [{ id: 1, toolId: 1, staffId: 3, issuedAt: NOW_ISO, returnedAt: null, dueBack: TODAY }];

  it("reports the administrative status when nobody is holding it", () => {
    expect(effectiveStatus(tool("available"), [])).toBe("available");
    expect(effectiveStatus(tool("in_service"), [])).toBe("in_service");
    expect(effectiveStatus(tool("retired"), [])).toBe("retired");
  });

  it("reports ON_ISSUE ahead of everything, because that is the actionable fact", () => {
    // The API cannot produce a retired tool that is still out — retiring one that is
    // out is refused — so this only matters for a hand-edited store. Which is exactly
    // when a useful answer is worth most: somebody has to bring it back.
    expect(effectiveStatus(tool("available"), held)).toBe("on_issue");
    expect(effectiveStatus(tool("in_service"), held)).toBe("on_issue");
    expect(effectiveStatus(tool("retired"), held)).toBe("on_issue");
  });

  it("treats an unrecognised stored status as available rather than crashing", () => {
    expect(effectiveStatus(tool("banana"), [])).toBe("available");
    expect(effectiveStatus(tool(undefined), [])).toBe("available");
  });
});

// --- the service ------------------------------------------------------------

function makeStoreDouble(initial = DEFAULT_DATA) {
  let data = clone(initial);
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

const STAFF = [
  { id: 3, userId: USER_ID, name: "Marek", surname: "Nowak", age: 41 },
  { id: 4, userId: USER_ID, name: "Ala", surname: "Zielinska", age: 29 },
];

/**
 * A context with real loader semantics and a steerable training pillar.
 *
 * `training` is the seam that matters. Passing `null` models the pillar having
 * failed to load — which §16 asks the gate to survive by REFUSING — and passing a
 * function models it answering.
 */
function makeContext({ userId = USER_ID, staff = STAFF, today = TODAY, training = permissiveTraining() } = {}) {
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

  const staffById = new Map(staff.map((record) => [Number(record.id), record]));

  const published = [];

  const context = {
    // The real notifier with a fake publisher, so notifier.js's userId stamping
    // is exercised rather than stubbed past. Emitted events land in
    // `context.published` for assertions.
    notifier: createCrewNotifier({ userId, publish: (event) => published.push(event) }),
    published,
    userId,
    hasWritableIdentity: Number.isFinite(userId),
    assertWritableIdentity() {
      if (!this.hasWritableIdentity) throw new CrewError(CREW_ERROR_CODES.UNAUTHENTICATED, "no usable account id");
    },
    clock: { today: () => today, nowIso: () => NOW_ISO },
    pillars: ["profiles", "tools"],
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead(name) {
      this.storeReads.total += 1;
      this.storeReads.byStore[name] = (this.storeReads.byStore[name] || 0) + 1;
    },
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
      const id = Number(staffId);
      const record = staffById.get(id) || null;
      if (!record) return null;
      return { staffId: id, staff: record, profile: null };
    },
    async listCrew() {
      return staff.map((record) => ({ staffId: Number(record.id), staff: record, profile: null }));
    },
  };

  // `null` means the pillar is not there at all, which is a different thing from a
  // pillar that says no — and both must refuse.
  if (training !== null) context.services.training = training;

  return context;
}

const permissiveTraining = () => ({
  async evaluateCertification() {
    return { outcome: "PERMITTED", status: "valid", course: { id: 1, code: "chainsaw" }, certification: { id: 1 } };
  },
});

async function setup({ today, training, staff, userId } = {}) {
  const store = makeStoreDouble();
  const context = makeContext({ today, training, staff, userId });
  const service = createToolsService(context, { store });
  context.services.tools = service;
  return { service, store, context };
}

/** A registered tool, which is the starting point for most cases. */
async function registered(service, overrides = {}) {
  const result = await service.registerTool({
    assetTag: "CHS-001",
    name: "Chainsaw MS261",
    category: "POWERED_HAND_TOOL",
    requiresCertification: null,
    serviceIntervalDays: 180,
    lastServicedOn: TODAY,
    storageLocation: "Workshop A",
    ...overrides,
  });
  expect(result.outcome).toBe("REGISTERED");
  return result.tool;
}

const issue = (service, tool, overrides = {}) =>
  service.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 3), ...overrides });

describe("the registry", () => {
  it("registers a tool, upper-casing the asset tag, and finds it by tag", async () => {
    const { service } = await setup();
    const tool = await registered(service, { assetTag: "chs-001" });
    expect(tool.assetTag).toBe("CHS-001");
    expect(await service.findToolByAssetTag("chs-001")).toMatchObject({ id: tool.id });
  });

  it("stores an ADMINISTRATIVE status only — never on_issue (rule 1)", async () => {
    const { service, store } = await setup();
    const tool = await registered(service);
    expect(tool.status).toBe("available");

    expect((await issue(service, tool)).outcome).toBe("ISSUED");

    // The stored row is untouched by possession; the graph's ON_ISSUE is computed.
    const stored = store.snapshot().tools.find((row) => row.id === tool.id);
    expect(stored.status).toBe("available");
    expect(stored).not.toHaveProperty("heldBy");
    expect(await service.statusOf(stored)).toBe("on_issue");
  });

  it("stores a chosen icon as its key, never as a CSS class", async () => {
    // The key is the pillar's vocabulary; which glyph it draws is the page's business.
    // A stored class name would be both a styling injection and a hostage to the front
    // end's icon library.
    const { service } = await setup();
    const tool = await registered(service, { assetTag: "TRC-014", icon: "TRACTOR" });
    expect(tool.icon).toBe("tractor");
  });

  it("registers happily with no icon — the category is the fallback", async () => {
    const { service } = await setup();
    expect((await registered(service, { assetTag: "NIC-001" })).icon).toBeNull();
    expect((await registered(service, { assetTag: "NIC-002", icon: null })).icon).toBeNull();
  });

  it("refuses an icon that is not on the list", async () => {
    // The graph's `ToolIcon` enum stops this before a resolver runs, but the service is
    // also called by the seed and by tests — and an unchecked value ends up in a
    // `class` attribute.
    const { service } = await setup();
    const result = await service.registerTool({
      assetTag: "BAD-001",
      name: "Suspicious spanner",
      icon: 'fa-wrench" onmouseover="alert(1)',
    });
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(result.fieldErrors.map((error) => error.field)).toContain("icon");
  });

  it("refuses a duplicate asset tag — it is the handle a person uses", async () => {
    const { service } = await setup();
    await registered(service);
    const again = await service.registerTool({ assetTag: "chs-001", name: "Another chainsaw" });
    expect(again.outcome).toBe("VALIDATION_FAILED");
    expect(again.fieldErrors[0].field).toBe("assetTag");
  });

  it("accepts a requiresCertification code no course answers to yet", async () => {
    // Deliberate, not an omission: §8.5 makes an unmatched code a
    // CertificationCheckUnavailable at ISSUE time, which refuses. Validating here
    // would force the two stores to be populated in one particular order.
    const { service } = await setup();
    const tool = await registered(service, { requiresCertification: "chainsaw" });
    expect(tool.requiresCertification).toBe("chainsaw");
  });

  it("hides retired tools by default and shows them when asked", async () => {
    const { service } = await setup();
    const keep = await registered(service);
    const scrap = await registered(service, { assetTag: "SHV-007", name: "Spade", serviceIntervalDays: null, lastServicedOn: null });
    expect((await service.retireTool({ toolId: scrap.id, reason: "handle snapped" })).outcome).toBe("RETIRED");

    expect((await service.listTools()).map((row) => row.id)).toEqual([keep.id]);
    expect((await service.listTools({ includeRetired: true })).map((row) => row.id).sort()).toEqual([keep.id, scrap.id].sort());
    // Asking for the status explicitly is also asking to see them.
    expect((await service.listTools({ status: "retired" })).map((row) => row.id)).toEqual([scrap.id]);
  });

  it("filters by category and by service status", async () => {
    const { service } = await setup();
    await registered(service, { assetTag: "CHS-001", category: "POWERED_HAND_TOOL", serviceIntervalDays: 180, lastServicedOn: TODAY });
    await registered(service, { assetTag: "PPE-003", category: "PPE", serviceIntervalDays: 365, lastServicedOn: null });

    expect((await service.listTools({ category: "ppe" })).map((row) => row.assetTag)).toEqual(["PPE-003"]);
    // The never-serviced harness, and only it.
    expect((await service.listTools({ serviceStatus: "overdue" })).map((row) => row.assetTag)).toEqual(["PPE-003"]);
    expect((await service.listTools({ serviceStatus: "ok" })).map((row) => row.assetTag)).toEqual(["CHS-001"]);
  });

  it("validates the input", () => {
    expect(
      validateToolInput({})
        .map((error) => error.field)
        .sort(),
    ).toEqual(["assetTag", "name"]);
    expect(validateToolInput({ assetTag: "a b", name: "x" })[0].field).toBe("assetTag");
    expect(validateToolInput({ assetTag: "OK-1", name: "x", category: "spaceship" })[0].field).toBe("category");
    expect(validateToolInput({ assetTag: "OK-1", name: "x", serviceIntervalDays: 0 })[0].field).toBe("serviceIntervalDays");
    expect(validateToolInput({ assetTag: "OK-1", name: "x", serviceIntervalDays: 99999 })[0].field).toBe("serviceIntervalDays");
    expect(validateToolInput({ assetTag: "OK-1", name: "x", requiresCertification: "Chain Saw" })[0].field).toBe("requiresCertification");
    // A tool cannot have been serviced in the future.
    expect(validateToolInput({ assetTag: "OK-1", name: "x", lastServicedOn: addDays(TODAY, 1) }, { today: TODAY })[0].field).toBe(
      "lastServicedOn",
    );
    expect(validateToolInput({ assetTag: "OK-1", name: "Chainsaw", serviceIntervalDays: 180 }, { today: TODAY })).toEqual([]);
  });

  it("normalises an unknown category to other rather than losing the tool", () => {
    expect(normaliseCategory("MACHINERY")).toBe("machinery");
    expect(normaliseCategory("spaceship")).toBe("other");
    expect(normaliseInterval("180")).toBe(180);
    expect(normaliseInterval(0)).toBeNull();
    expect(TOOL_CATEGORIES).toContain("powered_hand_tool");
  });

  it("refuses every write when the session has no usable account id", async () => {
    const { service } = await setup({ userId: Number("nope") });
    await expect(service.registerTool({ assetTag: "CHS-001", name: "Chainsaw" })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.UNAUTHENTICATED,
    });
  });
});

describe("issue and return", () => {
  it("issues a tool, and the holder is derivable from the ledger afterwards", async () => {
    const { service } = await setup();
    const tool = await registered(service);

    const result = await issue(service, tool);
    expect(result.outcome).toBe("ISSUED");
    expect(result.issuance).toMatchObject({ toolId: tool.id, staffId: 3, returnedAt: null, conditionOnReturn: null });

    expect((await service.toolsOnIssue()).map((row) => row.id)).toEqual([tool.id]);
    expect(await service.currentIssuanceOf(await service.findTool(tool.id))).toMatchObject({ staffId: 3 });
  });

  it("refuses a second issue while somebody is holding it, naming the holder", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    const again = await issue(service, tool, { staffId: 4 });
    expect(again).toMatchObject({ outcome: "UNAVAILABLE", reason: "ON_ISSUE", currentHolder: 3 });
  });

  it("returns a tool and then reissues it — Phase 6's return-then-reissue", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    const returned = await service.returnTool({ toolId: tool.id, condition: "GOOD" });
    expect(returned).toMatchObject({ outcome: "RETURNED", late: false });
    expect(returned.issuance.returnedAt).toBe(NOW_ISO);
    expect(returned.issuance.conditionOnReturn).toBe("good");
    expect(await service.statusOf(returned.tool)).toBe("available");

    expect((await issue(service, tool, { staffId: 4 })).outcome).toBe("ISSUED");
    // Two rows in the ledger, one closed and one open. Nothing was overwritten.
    const ledger = await service.ledgerForTool(tool.id);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row) => row.staffId)).toEqual([3, 4]);
    expect(replayLedger(ledger, tool.id)).toMatchObject({ holder: 4, violations: [] });
  });

  it("keeps a tool off the run when it comes back DAMAGED or NEEDS_SERVICE", async () => {
    for (const condition of ["DAMAGED", "NEEDS_SERVICE"]) {
      const { service } = await setup();
      const tool = await registered(service);
      await issue(service, tool);
      await service.returnTool({ toolId: tool.id, condition });

      expect(await service.statusOf(await service.findTool(tool.id))).toBe("in_service");
      const blocked = await issue(service, tool);
      expect(blocked).toMatchObject({ outcome: "UNAVAILABLE", reason: "IN_SERVICE" });
    }
  });

  it("retires a tool returned LOST, naming the issuance in the reason", async () => {
    // A tool that is not coming back must not be issuable, and "retired, lost on
    // issuance 1" is the honest terminal state for one that will not.
    const { service } = await setup();
    const tool = await registered(service);
    const { issuance } = await issue(service, tool);

    const returned = await service.returnTool({ toolId: tool.id, condition: "LOST", note: "left in the north field" });
    expect(returned.outcome).toBe("RETURNED");
    expect(returned.tool).toMatchObject({ status: "retired", retiredOn: TODAY });
    expect(returned.tool.retiredReason).toContain(`issuance ${issuance.id}`);
    expect((await issue(service, tool)).reason).toBe("RETIRED");
  });

  it("records a late return as late without treating it as a live alarm", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    // Issued with a due date already behind us. Only possible by writing the ledger
    // directly, which is why the row is planted rather than requested.
    await issue(service, tool);
    const ledger = await service.ledgerForTool(tool.id);
    expect(service.isOverdueBackOf(ledger[0])).toBe(false);

    const late = { ...ledger[0], dueBack: addDays(TODAY, -2) };
    expect(service.isOverdueBackOf(late)).toBe(true);
    expect(service.wasReturnedLateOf({ ...late, returnedAt: NOW_ISO })).toBe(true);
  });

  it("refuses a return when nobody has it", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    const result = await service.returnTool({ toolId: tool.id, condition: "GOOD" });
    expect(result).toMatchObject({ outcome: "NOT_ON_ISSUE", status: "available" });
  });

  it("reports a tool the caller cannot see as UNAVAILABLE / NOT_FOUND, not as an error", async () => {
    // §8.5's union has no ToolNotFound member, and folding it into UNAVAILABLE
    // answers the request without confirming whether the tool exists (§9).
    const { service } = await setup();
    expect(await issue(service, { id: 999 })).toMatchObject({ outcome: "UNAVAILABLE", reason: "NOT_FOUND", tool: null });
    expect(await service.returnTool({ toolId: 999, condition: "GOOD" })).toMatchObject({ outcome: "NOT_FOUND" });
  });

  it("refuses an issue to a member who is not the caller's, without disclosing existence", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await expect(issue(service, tool, { staffId: 99 })).rejects.toMatchObject({ code: CREW_ERROR_CODES.MEMBER_NOT_FOUND });
  });

  it("requires a dueBack date, and refuses a nonsensical one", () => {
    // The one opinion in the validator: a row with no due date can never appear in
    // overdueReturns, which is how a tool quietly stops being anybody's problem.
    expect(validateIssueInput({ toolId: 1, staffId: 3 }, { today: TODAY }).map((e) => e.field)).toEqual(["dueBack"]);
    expect(validateIssueInput({ toolId: 1, staffId: 3, dueBack: addDays(TODAY, -1) }, { today: TODAY })[0].field).toBe("dueBack");
    expect(validateIssueInput({ toolId: 1, staffId: 3, dueBack: addDays(TODAY, MAX_LOAN_DAYS + 1) }, { today: TODAY })[0].field).toBe(
      "dueBack",
    );
    // Due back today is legal — a tool out for the morning.
    expect(validateIssueInput({ toolId: 1, staffId: 3, dueBack: TODAY }, { today: TODAY })).toEqual([]);
  });

  it("validates the return condition against the four the domain knows", () => {
    expect(validateReturnInput({ toolId: 1, condition: "PERFECT" })[0].field).toBe("condition");
    for (const condition of RETURN_CONDITIONS) {
      expect(validateReturnInput({ toolId: 1, condition })).toEqual([]);
      expect(STATUS_AFTER_RETURN[condition]).toBeDefined();
    }
  });

  it("reports overdue returns across the crew, and per member", async () => {
    const { service, store } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    // Backdate the due date in the store, which is the only way to have an overdue
    // row without a clock that moves, then read it through a fresh service so no
    // loader is holding the pre-edit snapshot.
    const data = store.snapshot();
    data.issuances[0].dueBack = addDays(TODAY, -4);
    await store.update(() => data);

    const context = makeContext();
    const reread = createToolsService(context, { store });
    context.services.tools = reread;

    expect((await reread.overdueReturns()).map((row) => row.id)).toEqual([1]);
    expect((await reread.issuancesFor(3, { overdue: true })).map((row) => row.id)).toEqual([1]);
    expect(await reread.issuancesFor(4, { overdue: true })).toEqual([]);
  });
});

describe("double-issue under concurrency — exactly one ToolIssued", () => {
  it("refuses the second of two concurrent issues of the same tool", async () => {
    // Phase 6's headline test. Both calls pass the pre-flight availability check
    // against the same pre-write snapshot — that is the point, and it is what makes
    // this a real race rather than a formality. What saves it is that the in-lock
    // re-check reads the document the append is written to, so the second writer
    // sees the first writer's row.
    const { service, store } = await setup();
    const tool = await registered(service);

    const [a, b] = await Promise.all([issue(service, tool, { staffId: 3 }), issue(service, tool, { staffId: 4 })]);

    expect([a.outcome, b.outcome].sort()).toEqual(["ISSUED", "UNAVAILABLE"]);
    const refused = a.outcome === "UNAVAILABLE" ? a : b;
    expect(refused.reason).toBe("ON_ISSUE");

    // The store is the assertion that matters: two answers that look right while the
    // ledger holds two open rows is the exact failure this test exists to catch.
    const ledger = store.snapshot().issuances;
    expect(ledger).toHaveLength(1);
    expect(replayLedger(ledger, tool.id).violations).toEqual([]);
  });

  it("issues exactly once when five callers race for one tool", async () => {
    const { service, store } = await setup();
    const tool = await registered(service);

    const results = await Promise.all(Array.from({ length: 5 }, () => issue(service, tool)));
    expect(results.filter((result) => result.outcome === "ISSUED")).toHaveLength(1);
    expect(store.snapshot().issuances).toHaveLength(1);
    expect(store.snapshot().counters.lastIssuanceId).toBe(1);
  });

  it("lets two DIFFERENT tools be issued concurrently — the lock is not a queue for one tool", async () => {
    const { service, store } = await setup();
    const chainsaw = await registered(service);
    const drill = await registered(service, { assetTag: "DRL-002", name: "Drill" });

    const results = await Promise.all([issue(service, chainsaw), issue(service, drill, { staffId: 4 })]);
    expect(results.map((result) => result.outcome)).toEqual(["ISSUED", "ISSUED"]);
    expect(store.snapshot().issuances).toHaveLength(2);
  });

  it("serialises a concurrent return and reissue into a coherent ledger", async () => {
    const { service, store } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    const [returned, reissued] = await Promise.all([
      service.returnTool({ toolId: tool.id, condition: "GOOD" }),
      issue(service, tool, { staffId: 4 }),
    ]);

    expect(returned.outcome).toBe("RETURNED");
    // Whichever order they land in, the ledger must be legal: either the reissue got
    // in first and was refused, or the return got in first and it succeeded.
    expect(["ISSUED", "UNAVAILABLE"]).toContain(reissued.outcome);
    expect(replayLedger(store.snapshot().issuances, tool.id).violations).toEqual([]);
  });
});

describe("the certification gate (§8.5) — FAIL CLOSED", () => {
  const CONTROLLED = { assetTag: "CHS-001", name: "Chainsaw MS261", requiresCertification: "chainsaw" };

  it("issues when the tool requires no certification", async () => {
    const { service } = await setup({ training: null });
    const tool = await registered(service, { requiresCertification: null });
    // No training pillar at all, and it does not matter: there is nothing to check.
    expect((await issue(service, tool)).outcome).toBe("ISSUED");
  });

  it("issues when the member holds a live certificate", async () => {
    const { service } = await setup();
    const tool = await registered(service, CONTROLLED);
    expect((await issue(service, tool)).outcome).toBe("ISSUED");
  });

  it("refuses with REQUIRES_CERTIFICATION when the check says no", async () => {
    for (const status of [null, "expired", "revoked"]) {
      const { service } = await setup({
        training: {
          async evaluateCertification() {
            return { outcome: "NOT_CERTIFIED", status };
          },
        },
      });
      const tool = await registered(service, CONTROLLED);
      const result = await issue(service, tool);
      expect(result).toMatchObject({
        outcome: "REQUIRES_CERTIFICATION",
        requiredCertification: "chainsaw",
        certificationStatus: status,
      });
    }
  });

  it("refuses with CHECK_UNAVAILABLE when the TRAINING PILLAR IS NOT THERE — §16's checklist item", async () => {
    // The case the checklist calls out. A pillar that failed to load leaves
    // `context.services.training` absent, and absent must mean refused: the gate
    // being gone is not the same as the gate saying yes.
    const { service } = await setup({ training: null });
    const tool = await registered(service, CONTROLLED);
    expect(await issue(service, tool)).toMatchObject({ outcome: "CHECK_UNAVAILABLE", reason: "TRAINING_UNAVAILABLE" });
  });

  it("refuses when the training service exists but has no gate", async () => {
    const { service } = await setup({ training: { listCourses: async () => [] } });
    const tool = await registered(service, CONTROLLED);
    expect(await issue(service, tool)).toMatchObject({ outcome: "CHECK_UNAVAILABLE", reason: "TRAINING_UNAVAILABLE" });
  });

  it("refuses when the check THROWS", async () => {
    const { service } = await setup({
      training: {
        async evaluateCertification() {
          throw new Error("store on fire");
        },
      },
    });
    const tool = await registered(service, CONTROLLED);
    const result = await issue(service, tool);
    expect(result).toMatchObject({ outcome: "CHECK_UNAVAILABLE", reason: "CHECK_FAILED" });
    expect(result.detail).toContain("store on fire");
  });

  it("refuses when the check answers with something unreadable", async () => {
    for (const answer of [null, undefined, {}, "yes", { outcome: 42 }]) {
      const { service } = await setup({
        training: {
          async evaluateCertification() {
            return answer;
          },
        },
      });
      const tool = await registered(service, CONTROLLED);
      expect((await issue(service, tool)).outcome).toBe("CHECK_UNAVAILABLE");
    }
  });

  it("passes the training pillar's own UNAVAILABLE reasons through as refusals", async () => {
    // No course answers the code, or the training store is unreadable. §8.5 names
    // both explicitly, and both must refuse rather than silently allow.
    for (const reason of ["COURSE_NOT_DEFINED", "STORE_UNREADABLE", "NO_COURSE_CODE"]) {
      const { service } = await setup({
        training: {
          async evaluateCertification() {
            return { outcome: "UNAVAILABLE", reason, detail: "…" };
          },
        },
      });
      const tool = await registered(service, CONTROLLED);
      expect(await issue(service, tool)).toMatchObject({ outcome: "CHECK_UNAVAILABLE", reason });
    }
  });

  it("refuses an outcome it has never heard of — the gate is a whitelist", async () => {
    // The property that keeps this fail-closed as the training pillar grows. A
    // blacklist of known-bad outcomes would start passing the day a fifth one is
    // added; this refuses by default.
    const { service } = await setup({
      training: {
        async evaluateCertification() {
          return { outcome: "PROBABLY_FINE", status: "valid" };
        },
      },
    });
    const tool = await registered(service, CONTROLLED);
    expect((await issue(service, tool)).outcome).toBe("CHECK_UNAVAILABLE");
  });

  it("checks availability BEFORE certification, so an uncertified member is told the real reason", async () => {
    // A tool somebody else is holding reports UNAVAILABLE rather than sending the
    // caller to book a course they may not need — and the training store is not read
    // at all for a tool that could not go out anyway.
    let asked = 0;
    const { service } = await setup({
      training: {
        async evaluateCertification() {
          asked += 1;
          return { outcome: "NOT_CERTIFIED", status: null };
        },
      },
    });
    const tool = await registered(service, { ...CONTROLLED, requiresCertification: null });
    await issue(service, tool);

    // Now make it certification-controlled and try to issue it while it is out.
    const controlled = { ...(await service.findTool(tool.id)), requiresCertification: "chainsaw" };
    expect(await service.issueTool({ toolId: controlled.id, staffId: 4, dueBack: addDays(TODAY, 1) })).toMatchObject({
      outcome: "UNAVAILABLE",
      reason: "ON_ISSUE",
    });
    expect(asked).toBe(0);
  });

  it("answers the gate without writing, for a page that wants to grey out a button", async () => {
    const { service } = await setup({
      training: {
        async evaluateCertification() {
          return { outcome: "NOT_CERTIFIED", status: "expired" };
        },
      },
    });
    const tool = await registered(service, CONTROLLED);

    const check = await service.checkCertification(tool, 3);
    expect(check).toMatchObject({ outcome: "NOT_CERTIFIED", requiredCertification: "chainsaw", status: "expired" });
    // And it wrote nothing: the tool is still issuable to whoever is certified.
    expect(await service.statusOf(await service.findTool(tool.id))).toBe("available");
  });

  it("NEVER issues a certification-controlled tool on any non-positive answer", async () => {
    // Fail-closed is a property of the whole gate rather than of any one branch, so
    // it is restated here as a sweep. If a future edit adds a branch that falls
    // through to the append, this is the test that fails.
    const answers = [
      null,
      undefined,
      {},
      { outcome: "NOT_CERTIFIED", status: null },
      { outcome: "NOT_CERTIFIED", status: "expired" },
      { outcome: "NOT_CERTIFIED", status: "revoked" },
      { outcome: "UNAVAILABLE", reason: "COURSE_NOT_DEFINED" },
      { outcome: "UNAVAILABLE", reason: "STORE_UNREADABLE" },
      { outcome: "PERMITTED_MAYBE" },
      { outcome: "" },
      { outcome: "permitted" }, // lower case is NOT the sentinel
    ];

    for (const answer of answers) {
      const { service, store } = await setup({
        training: {
          async evaluateCertification() {
            return answer;
          },
        },
      });
      const tool = await registered(service, CONTROLLED);
      const result = await issue(service, tool);

      expect(result.outcome).not.toBe("ISSUED");
      expect(store.snapshot().issuances).toEqual([]);
    }

    // And the same sweep with the pillar missing entirely, and with it throwing.
    for (const training of [
      null,
      {
        async evaluateCertification() {
          throw new Error("nope");
        },
      },
    ]) {
      const { service, store } = await setup({ training });
      const tool = await registered(service, CONTROLLED);
      expect((await issue(service, tool)).outcome).not.toBe("ISSUED");
      expect(store.snapshot().issuances).toEqual([]);
    }
  });

  it("shapes the gate's answer into CertificationCheck the same way for both callers", () => {
    // `certificationCheck` and the `issueTool` union member are the same function's
    // answer read two ways, so a UI cannot drift from the mutation.
    expect(certificationCheck({ outcome: "PERMITTED", requiredCertification: null, status: null })).toMatchObject({
      permitted: true,
      unavailableReason: null,
    });
    expect(certificationCheck({ outcome: "NOT_CERTIFIED", requiredCertification: "chainsaw", status: "expired" })).toMatchObject({
      permitted: false,
      certificationStatus: "expired",
      unavailableReason: null,
    });
    expect(
      certificationCheck({ outcome: "CHECK_UNAVAILABLE", requiredCertification: "chainsaw", reason: "STORE_UNREADABLE" }),
    ).toMatchObject({ permitted: false, unavailableReason: "STORE_UNREADABLE" });
  });

  it("coerces an unknown gate reason onto the enum instead of failing to serialise", () => {
    // A value outside CertificationCheckFailure would make the field fail to
    // serialise, and a refusal that arrives as a serialisation error is one a client
    // is liable to retry. Every value it can land on is still a refusal.
    expect(toFailureReason("STORE_UNREADABLE")).toBe("STORE_UNREADABLE");
    expect(toFailureReason("store_unreadable")).toBe("STORE_UNREADABLE");
    expect(toFailureReason("CHECK_UNAVAILABLE")).toBe("CERTIFICATION_CHECK_UNAVAILABLE");
    expect(toFailureReason(undefined)).toBe("CERTIFICATION_CHECK_UNAVAILABLE");

    const member = issueOutcome({ outcome: "CHECK_UNAVAILABLE", tool: {}, requiredCertification: "chainsaw", reason: "WHAT" });
    expect(member).toMatchObject({ __typename: "CertificationCheckUnavailable", failure: "CERTIFICATION_CHECK_UNAVAILABLE" });
  });

  it("names the failure `failure`, not `reason` — IssueToolResult has to be selectable in one query", () => {
    // `ToolUnavailable.reason` is a `ToolUnavailableReason!` and this was a
    // `CertificationCheckFailure!`. Two same-named fields of different types in one
    // union make GraphQL reject any query that branches on both without aliases, so a
    // client asking "was it unavailable, or could we not check?" — the obvious
    // question — got a validation error instead of an answer. Caught by
    // `crew-leave-race.test.js` hitting the real endpoint.
    const unavailable = issueOutcome({ outcome: "UNAVAILABLE", reason: "ON_ISSUE", toolId: "1", currentHolder: 3 });
    const uncheckable = issueOutcome({ outcome: "CHECK_UNAVAILABLE", tool: {}, requiredCertification: "chainsaw", reason: "CHECK_FAILED" });

    expect(unavailable).toHaveProperty("reason");
    expect(uncheckable).not.toHaveProperty("reason");
    expect(uncheckable).toHaveProperty("failure");
    // And `ToolUnavailable` carries no `tool`, because `Tool` and `Tool!` are
    // conflicting shapes under the same rule.
    expect(unavailable).not.toHaveProperty("tool");
  });
});

describe("the service schedule", () => {
  it("records a service, resets the clock and brings the tool back on the shelf", async () => {
    const { service } = await setup();
    const tool = await registered(service, { serviceIntervalDays: 180, lastServicedOn: addDays(TODAY, -200) });
    expect(service.serviceStatusOf(tool)).toBe("overdue");

    const result = await service.recordService({ toolId: tool.id, performedBy: "Workshop", note: "chain + bar" });
    expect(result.outcome).toBe("SERVICED");
    expect(result.tool).toMatchObject({ lastServicedOn: TODAY, status: "available", version: 2 });
    expect(service.serviceStatusOf(result.tool)).toBe("ok");
    expect((await service.serviceHistory(tool.id)).map((row) => row.servicedOn)).toEqual([TODAY]);
  });

  it("brings a tool out of IN_SERVICE, which is how a damaged tool goes back into use", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await issue(service, tool);
    await service.returnTool({ toolId: tool.id, condition: "DAMAGED" });
    expect(await service.statusOf(await service.findTool(tool.id))).toBe("in_service");

    expect((await service.recordService({ toolId: tool.id })).outcome).toBe("SERVICED");
    expect(await service.statusOf(await service.findTool(tool.id))).toBe("available");
    expect((await issue(service, tool)).outcome).toBe("ISSUED");
  });

  it("refuses to service a tool that is OUT — you do not have it", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    expect(await service.recordService({ toolId: tool.id })).toMatchObject({
      outcome: "NOT_SERVICEABLE",
      status: "on_issue",
      currentHolder: 3,
    });
  });

  it("refuses to service a RETIRED tool", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await service.retireTool({ toolId: tool.id, reason: "worn out" });
    expect(await service.recordService({ toolId: tool.id })).toMatchObject({ outcome: "NOT_SERVICEABLE", status: "retired" });
  });

  it("never moves lastServicedOn BACKWARDS for a backdated record", async () => {
    // Filing April's paperwork in July must not make a tool serviced in June look
    // overdue. The record is still kept — the history is append-only.
    const { service } = await setup();
    const tool = await registered(service, { lastServicedOn: addDays(TODAY, -30) });

    const backdated = await service.recordService({ toolId: tool.id, servicedOn: addDays(TODAY, -120) });
    expect(backdated.outcome).toBe("SERVICED");
    expect(backdated.tool.lastServicedOn).toBe(addDays(TODAY, -30));
    expect((await service.serviceHistory(tool.id)).map((row) => row.servicedOn)).toEqual([addDays(TODAY, -120)]);
  });

  it("refuses a service recorded in the future", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    const result = await service.recordService({ toolId: tool.id, servicedOn: addDays(TODAY, 1) });
    expect(result).toMatchObject({ outcome: "VALIDATION_FAILED" });
    expect(result.fieldErrors[0].field).toBe("servicedOn");
  });

  it("honours expectedVersion, and raises a TOOL version conflict rather than a member one", async () => {
    const { service } = await setup();
    const tool = await registered(service);

    await expect(service.recordService({ toolId: tool.id, expectedVersion: 99 })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VERSION_CONFLICT,
      // A tool belongs to the farm, not to a person, so the conflict names the tool.
      extensions: { toolId: String(tool.id), expectedVersion: 99, actualVersion: 1 },
    });
    expect((await service.recordService({ toolId: tool.id, expectedVersion: 1 })).outcome).toBe("SERVICED");
  });

  it("reports a service on a tool the caller cannot see as NOT_FOUND", async () => {
    const { service } = await setup();
    expect(await service.recordService({ toolId: 404 })).toMatchObject({ outcome: "NOT_FOUND" });
  });
});

describe("retire semantics", () => {
  it("retires a tool with a date and a reason, and keeps every row", async () => {
    const { service, store } = await setup();
    const tool = await registered(service);
    await issue(service, tool);
    await service.returnTool({ toolId: tool.id, condition: "GOOD" });

    const result = await service.retireTool({ toolId: tool.id, reason: "beyond economic repair" });
    expect(result.outcome).toBe("RETIRED");
    expect(result.tool).toMatchObject({ status: "retired", retiredOn: TODAY, retiredReason: "beyond economic repair" });

    // Rule 4: nothing is deleted. The row, its ledger and its service history stay.
    const data = store.snapshot();
    expect(data.tools).toHaveLength(1);
    expect(data.issuances).toHaveLength(1);
    expect(await service.ledgerForTool(tool.id)).toHaveLength(1);
  });

  it("is terminal — a retired tool is never issued again", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await service.retireTool({ toolId: tool.id, reason: "worn out" });
    expect(await issue(service, tool)).toMatchObject({ outcome: "UNAVAILABLE", reason: "RETIRED" });
  });

  it("is not repeatable", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await service.retireTool({ toolId: tool.id, reason: "worn out" });

    expect(await service.retireTool({ toolId: tool.id, reason: "worn out again" })).toMatchObject({
      outcome: "ALREADY_RETIRED",
      retiredOn: TODAY,
      retiredReason: "worn out",
    });
  });

  it("refuses to retire a tool that is OUT — it has to come back first", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    expect(await service.retireTool({ toolId: tool.id, reason: "worn out" })).toMatchObject({
      outcome: "ON_ISSUE",
      currentHolder: 3,
    });
    // And the LOST return is the path for one that will not come back.
    await service.returnTool({ toolId: tool.id, condition: "LOST" });
    expect((await service.findTool(tool.id)).status).toBe("retired");
  });

  it("needs a reason — it is the only record of why", async () => {
    expect(validateRetireInput({ toolId: 1 })[0].field).toBe("reason");
    expect(validateRetireInput({ toolId: 1, reason: "   " })[0].field).toBe("reason");
    expect(validateRetireInput({ toolId: 1, reason: "worn out" })).toEqual([]);
  });

  it("honours expectedVersion", async () => {
    const { service } = await setup();
    const tool = await registered(service);
    await expect(service.retireTool({ toolId: tool.id, reason: "x", expectedVersion: 7 })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VERSION_CONFLICT,
    });
  });
});

describe("scoping (§9)", () => {
  it("shows one user nothing of another's registry, ledger or service history", async () => {
    const store = makeStoreDouble();

    const mineContext = makeContext({ userId: 1 });
    const one = createToolsService(mineContext, { store });
    mineContext.services.tools = one;
    const tool = await registered(one);
    await one.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 2) });

    // A second owner with a staff record of the SAME id — overlapping ids are the
    // case that catches a scoping bug that happens to work on distinct ones.
    const otherContext = makeContext({ userId: 2, staff: [{ id: 3, userId: 2, name: "Someone", surname: "Else", age: 30 }] });
    const two = createToolsService(otherContext, { store });
    otherContext.services.tools = two;

    expect(await two.listTools()).toEqual([]);
    expect(await two.findTool(tool.id)).toBeNull();
    expect(await two.findToolByAssetTag("CHS-001")).toBeNull();
    expect(await two.toolsOnIssue()).toEqual([]);
    expect(await two.overdueReturns()).toEqual([]);
    expect(await two.listOpenIssuances()).toEqual([]);
    expect(await two.issuancesFor(3)).toEqual([]);
    expect(await two.ledgerForTool(tool.id)).toEqual([]);
    expect(await two.serviceHistory(tool.id)).toEqual([]);
  });

  it("refuses a cross-user write as if the tool did not exist", async () => {
    const store = makeStoreDouble();
    const oneContext = makeContext({ userId: 1 });
    const one = createToolsService(oneContext, { store });
    oneContext.services.tools = one;
    const tool = await registered(one);

    const twoContext = makeContext({ userId: 2, staff: [{ id: 3, userId: 2, name: "Someone", surname: "Else", age: 30 }] });
    const two = createToolsService(twoContext, { store });
    twoContext.services.tools = two;

    expect(await two.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 2) })).toMatchObject({
      outcome: "UNAVAILABLE",
      reason: "NOT_FOUND",
    });
    expect(await two.returnTool({ toolId: tool.id, condition: "GOOD" })).toMatchObject({ outcome: "NOT_FOUND" });
    expect(await two.recordService({ toolId: tool.id })).toMatchObject({ outcome: "NOT_FOUND" });
    expect(await two.retireTool({ toolId: tool.id, reason: "x" })).toMatchObject({ outcome: "NOT_FOUND" });

    // And the other owner's tool is untouched by any of it.
    expect(await one.statusOf(await one.findTool(tool.id))).toBe("available");
    expect((await one.findTool(tool.id)).version).toBe(1);
  });

  it("reads each store once per request, whatever the crew size", async () => {
    const { service, context } = await setup();
    const tool = await registered(service);
    await issue(service, tool);

    context.storeReads.total = 0;
    context.storeReads.byStore = {};
    await service.listTools();
    await service.toolsOnIssue();
    await service.overdueReturns();
    await service.issuancesFor(3);
    expect(context.storeReads.byStore.crewTools ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("orphaned overlays (§12 rule 4)", () => {
  it("reports issuances whose staff record is gone, flagging the open ones", async () => {
    const store = makeStoreDouble();
    const context = makeContext();
    const service = createToolsService(context, { store });
    context.services.tools = service;

    const tool = await registered(service);
    await issue(service, tool);
    expect(await service.findOrphanedOverlays()).toEqual([]);

    // Rebuild over the same rows with staff 3 no longer in staff.json.
    const orphanedContext = makeContext({ staff: STAFF.filter((record) => record.id !== 3) });
    const orphaned = createToolsService(orphanedContext, { store });
    orphanedContext.services.tools = orphaned;

    const overlays = await orphaned.findOrphanedOverlays();
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ staffId: "3", rowId: "1" });
    // An open row against a deleted member is the one somebody has to chase.
    expect(overlays[0].detail).toContain("still open");
  });

  it("still reads a deleted member's history, but issues them nothing new", async () => {
    const store = makeStoreDouble();
    const context = makeContext();
    const service = createToolsService(context, { store });
    context.services.tools = service;
    const tool = await registered(service);
    await issue(service, tool);
    await service.returnTool({ toolId: tool.id, condition: "GOOD" });

    const after = makeContext({ staff: STAFF.filter((record) => record.id !== 3) });
    const later = createToolsService(after, { store });
    after.services.tools = later;

    expect(await later.issuancesFor(3)).toHaveLength(1);
    await expect(later.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 1) })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.MEMBER_NOT_FOUND,
    });
  });
});

describe("notification events", () => {
  it("announces an issue, addressed to the owner and naming the tool", async () => {
    const { service, context } = await setup();
    const tool = await registered(service);
    const before = context.published.length;

    const issued = await service.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 3) });
    expect(issued.outcome).toBe("ISSUED");

    const event = context.published.slice(before).find((row) => row.type === CREW_EVENTS.TOOL_ISSUED);
    expect(event).toBeTruthy();
    expect(event.payload).toMatchObject({
      issuanceId: String(issued.issuance.id),
      toolId: tool.id,
      toolName: "Chainsaw MS261",
      staffId: 3,
      dueBack: addDays(TODAY, 3),
    });
    expect(event.payload.userId).toBe(USER_ID);
  });

  it("announces a return, carrying the condition and where it sent the tool", async () => {
    const { service, context } = await setup();
    const tool = await registered(service);
    await service.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 3) });
    const before = context.published.length;

    const returned = await service.returnTool({ toolId: tool.id, condition: "NEEDS_SERVICE" });
    expect(returned.outcome).toBe("RETURNED");

    const event = context.published.slice(before).find((row) => row.type === CREW_EVENTS.TOOL_RETURNED);
    expect(event.payload).toMatchObject({ toolId: tool.id, toolName: "Chainsaw MS261", staffId: 3 });
    // The condition decided the tool's fate; the event says so rather than making
    // a reader ask a second question.
    expect(event.payload.toolStatus).toBe(returned.tool.status);
    expect(event.payload.late).toBe(false);
  });

  it("gives the issue and its return ONE correlationId — out and back are one trip", async () => {
    const { service, context } = await setup();
    const tool = await registered(service);
    const issued = await service.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 3) });
    await service.returnTool({ toolId: tool.id, condition: "GOOD" });

    const [issue, ret] = [CREW_EVENTS.TOOL_ISSUED, CREW_EVENTS.TOOL_RETURNED].map((type) =>
      context.published.find((row) => row.type === type),
    );
    expect(issue.correlationId).toBe(`crew-tool-issuance-${issued.issuance.id}`);
    expect(ret.correlationId).toBe(issue.correlationId);
  });

  it("says nothing when the issue was refused", async () => {
    const { service, context } = await setup();
    const tool = await registered(service);
    await service.issueTool({ toolId: tool.id, staffId: 3, dueBack: addDays(TODAY, 3) });
    const after = context.published.length;

    // Already out — the second issue is UNAVAILABLE, and an unavailable tool is
    // not an event.
    const again = await service.issueTool({ toolId: tool.id, staffId: 4, dueBack: addDays(TODAY, 3) });
    expect(again.outcome).toBe("UNAVAILABLE");
    expect(await service.returnTool({ toolId: 999, condition: "GOOD" })).toMatchObject({ outcome: "NOT_FOUND" });

    expect(context.published.length).toBe(after);
  });
});
