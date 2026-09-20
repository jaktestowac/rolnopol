/**
 * Idempotent demo seed for the tools pillar (PRD §11).
 *
 * Same two rules as the other pillars' seeds —
 *
 *   - **idempotent**: a tool is only added when its asset tag is absent, and
 *     issuances only when that owner has none, so running it twice changes nothing;
 *   - **crew stores only**: it never touches `staff.json`; it hands tools to the
 *     people who are already there (§12.2).
 *
 * The tool list below is chosen so every interesting state is present on a fresh
 * install rather than waiting to be discovered:
 *
 *   - a tool `due_soon` and a tool `overdue` for service, so the schedule is visibly
 *     doing something;
 *   - a tool with **no service interval at all** (the spade), so "never due
 *     anything" is distinguishable from "not due yet";
 *   - a tool with an interval but **no service history** (the harness), which reads
 *     as `overdue` — decision 4 in `ledger.js`, and the one people are surprised by;
 *   - one open issuance in date, one open issuance **overdue back**, and one closed
 *     row, so `overdueReturns` and the ledger's history both have something in them;
 *   - the chainsaw left AVAILABLE and requiring the `chainsaw` certification, which
 *     the training seed grants to exactly one member. So issuing it demonstrates the
 *     gate both ways — `ToolIssued` for that member, `ToolRequiresCertification` for
 *     everybody else — without anybody having to set the data up.
 */
const { getStore, read, transact } = require("./store");
const { addDays } = require("../../clock");

/**
 * `servicedDaysAgo` is relative to the seed date, so the resulting `serviceStatus`
 * is the same on whatever day a fresh install happens to be run.
 *
 * Read it with `serviceIntervalDays`: 175 days ago on a 180-day interval leaves 5
 * days, which is inside the 14-day notice window ⇒ `due_soon`. 100 days ago on a
 * 90-day interval is 10 days past ⇒ `overdue`.
 */
const TOOLS = [
  {
    assetTag: "CHS-001",
    name: "Chainsaw MS261",
    category: "powered_hand_tool",
    icon: "chainsaw",
    requiresCertification: "chainsaw",
    serviceIntervalDays: 180,
    servicedDaysAgo: 175,
    storageLocation: "Workshop A",
  },
  {
    assetTag: "TRC-014",
    name: "Tractor Zetor 8441",
    category: "vehicle",
    icon: "tractor",
    requiresCertification: null,
    serviceIntervalDays: 90,
    servicedDaysAgo: 100,
    storageLocation: "Machine shed",
  },
  {
    assetTag: "DRL-002",
    name: "Cordless drill 18V",
    category: "powered_hand_tool",
    icon: "screwdriver",
    requiresCertification: null,
    serviceIntervalDays: 365,
    servicedDaysAgo: 30,
    storageLocation: "Workshop A",
  },
  {
    // No interval: never due anything, and `serviceStatus` says OK rather than
    // pretending a shovel has a maintenance schedule.
    assetTag: "SHV-007",
    name: "Digging spade",
    category: "hand_tool",
    icon: "seedling",
    requiresCertification: null,
    serviceIntervalDays: null,
    servicedDaysAgo: null,
    storageLocation: "Tool store",
  },
  {
    // An interval and NO history. Reads as OVERDUE — decision 4. A harness whose
    // inspection date nobody recorded is exactly the thing that should be red.
    assetTag: "PPE-003",
    name: "Fall-arrest harness",
    category: "ppe",
    icon: "vest",
    requiresCertification: null,
    serviceIntervalDays: 365,
    servicedDaysAgo: null,
    storageLocation: "Tool store",
  },
];

/**
 * Who gets what, by position in the owner's staff list.
 *
 * `staffIndex` rather than a staff id, because a seed cannot know what ids an
 * account happens to have. An owner with fewer members than this simply gets fewer
 * issuances.
 */
const ISSUANCE_PLAN = [
  // Open, in date.
  { assetTag: "DRL-002", staffIndex: 0, issuedDaysAgo: 1, dueInDays: 3, note: "Fencing repairs, north paddock." },
  // Open and OVERDUE back — what `overdueReturns` is for.
  { assetTag: "SHV-007", staffIndex: 1, issuedDaysAgo: 9, dueInDays: -2, note: "Drainage ditch." },
  // Closed, returned in good order. The ledger's history, and proof that a returned
  // tool is issuable again.
  { assetTag: "TRC-014", staffIndex: 0, issuedDaysAgo: 20, dueInDays: -18, returnedDaysAgo: 19, condition: "good" },
];

async function seedTools({ staffRecords, today, nowIso }) {
  const store = getStore();
  const existing = await read(store);

  return transact(store, (document) => {
    let lastToolId = document.counters.lastToolId;
    let lastIssuanceId = document.counters.lastIssuanceId;
    let lastServiceRecordId = document.counters.lastServiceRecordId;

    const byUser = new Map();
    for (const staff of staffRecords) {
      const list = byUser.get(Number(staff.userId)) || [];
      list.push(staff);
      byUser.set(Number(staff.userId), list);
    }

    const addedTools = [];
    const addedIssuances = [];
    const addedServiceRecords = [];

    for (const [userId] of byUser.entries()) {
      const tagsPresent = new Set(
        document.tools.filter((row) => Number(row.userId) === userId).map((row) => String(row.assetTag).toUpperCase()),
      );

      for (const template of TOOLS) {
        if (tagsPresent.has(template.assetTag)) continue;
        lastToolId += 1;
        const lastServicedOn = template.servicedDaysAgo === null ? null : addDays(today, -template.servicedDaysAgo);

        addedTools.push({
          id: lastToolId,
          userId,
          assetTag: template.assetTag,
          name: template.name,
          category: template.category,
          // Seeded WITH an icon so a fresh install shows the picker doing something.
          icon: template.icon ?? null,
          requiresCertification: template.requiresCertification,
          serviceIntervalDays: template.serviceIntervalDays,
          lastServicedOn,
          // Administrative status only — possession is derived (§8.5).
          status: "available",
          storageLocation: template.storageLocation,
          retiredOn: null,
          retiredReason: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        });

        // A `lastServicedOn` with no matching record would make the service history
        // contradict the tool it belongs to.
        if (lastServicedOn) {
          lastServiceRecordId += 1;
          addedServiceRecords.push({
            id: lastServiceRecordId,
            userId,
            toolId: lastToolId,
            servicedOn: lastServicedOn,
            performedBy: "Workshop",
            note: "Seeded demo service.",
            createdAt: nowIso,
          });
        }
      }
    }

    const tools = [...document.tools, ...addedTools];

    for (const [userId, staff] of byUser.entries()) {
      // Only when this owner has no issuances at all, so a seed can never scribble
      // over a ledger somebody built. The ledger is append-only, so an accidental
      // append would be permanent.
      if (document.issuances.some((row) => Number(row.userId) === userId)) continue;

      const toolByTag = new Map(
        tools.filter((row) => Number(row.userId) === userId).map((row) => [String(row.assetTag).toUpperCase(), row]),
      );

      for (const plan of ISSUANCE_PLAN) {
        const tool = toolByTag.get(plan.assetTag);
        const member = staff[plan.staffIndex];
        if (!tool || !member) continue;

        const issuedOn = addDays(today, -plan.issuedDaysAgo);
        lastIssuanceId += 1;
        addedIssuances.push({
          id: lastIssuanceId,
          userId,
          toolId: Number(tool.id),
          staffId: Number(member.id),
          issuedAt: `${issuedOn}T06:10:00.000Z`,
          dueBack: addDays(today, plan.dueInDays),
          returnedAt: plan.returnedDaysAgo === undefined ? null : `${addDays(today, -plan.returnedDaysAgo)}T16:30:00.000Z`,
          conditionOnReturn: plan.condition ?? null,
          note: plan.note ?? null,
          returnNote: null,
          createdAt: nowIso,
        });
      }
    }

    return {
      document: {
        ...document,
        tools,
        issuances: [...document.issuances, ...addedIssuances],
        serviceRecords: [...document.serviceRecords, ...addedServiceRecords],
        counters: { ...document.counters, lastToolId, lastIssuanceId, lastServiceRecordId },
      },
      result: {
        toolsCreated: addedTools.length,
        issuancesCreated: addedIssuances.length,
        serviceRecordsCreated: addedServiceRecords.length,
        toolsBefore: existing.tools.length,
      },
    };
  });
}

module.exports = { seedTools, TOOLS, ISSUANCE_PLAN };
