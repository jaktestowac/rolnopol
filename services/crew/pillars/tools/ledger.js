/**
 * The issuance ledger and the service schedule — the pure core of the tools
 * pillar (PRD §8.5, §14.1).
 *
 * No store, no context, no clock of its own: `today` is always a parameter, for
 * the same reason as `training/expiry.js`. Every question this pillar answers is a
 * question about a boundary — is a tool due a service today or tomorrow, is it
 * overdue back or merely due back — and a boundary you cannot stand on is a
 * boundary you cannot test.
 *
 * Five decisions live here.
 *
 *   1. **The current holder is DERIVED, never stored** (§8.5). Nothing writes a
 *      `heldBy` field on a tool. There are two implementations of "who has it" in
 *      this file on purpose — `currentIssuance` reads the open row, `replayLedger`
 *      folds the whole ledger as a time-ordered event stream — and
 *      `crew-tools-ledger.pbt.test.js` asserts they agree for any random
 *      issue/return sequence. A single implementation would make that property
 *      unfalsifiable, which is another way of saying untested.
 *
 *   2. **A row is closed once and never reopened.** The ledger grows by appending
 *      issue rows; a return stamps `returnedAt` and `conditionOnReturn` on the row
 *      it closes and nothing ever writes those fields again. That is what §6.6's
 *      append-only rule buys here: "who had the chainsaw in July?" stays
 *      answerable after it has been out four more times.
 *
 *   3. **`dueBack` is the last day, not the first late one.** A tool due back today
 *      is not overdue; it is overdue tomorrow. Same shape as a certificate being
 *      valid through its expiry date, and chosen for the same reason: there is no
 *      hour at which something silently goes late mid-shift.
 *
 *   4. **A tool that has never been serviced is `overdue`, not `ok`.** When a tool
 *      carries a service interval but no `lastServicedOn`, "we do not know when
 *      this was last serviced" must not render as "fine". This is the same
 *      fail-closed instinct as the certification gate, applied to a milder risk.
 *
 *   5. **No service interval means no service schedule.** Some things — a shovel,
 *      a set of overalls — are never due anything. Treating a missing interval as
 *      zero would mark every one of them overdue on the day it was registered, and
 *      a report where everything is red is a report nobody reads.
 */
const { daysBetween, addDays } = require("../../clock");

/**
 * What a tool is, for the graph (§6.5).
 *
 * `on_issue` is the odd one out and it is worth being explicit: it is **never
 * stored**. Decision 1 means possession is a fact about the ledger, so the stored
 * `status` field only ever holds an ADMINISTRATIVE state, and `on_issue` is
 * computed by `effectiveStatus` overlaying the ledger on top of it. §6.5's comment
 * lists all four together as if they were one field; they are not, and keeping two
 * writable sources of truth for "is it out?" is precisely the drift this pillar is
 * built to avoid.
 */
const TOOL_STATUSES = ["available", "on_issue", "in_service", "retired"];

/** The subset the store may hold. Decision 1. */
const ADMIN_STATUSES = ["available", "in_service", "retired"];

/** Where a tool sits against its service interval (§8.5). */
const SERVICE_STATUSES = ["ok", "due_soon", "overdue"];

/**
 * The state a tool came back in.
 *
 * Three of the four make the tool un-issuable, which is the point of asking:
 *
 *   - `good` — back on the shelf, `available`;
 *   - `needs_service` / `damaged` — `in_service`. It does not go out again until
 *     somebody records a service against it. This is how `in_service` is reached
 *     without a sixth mutation §8.5 does not list;
 *   - `lost` — `retired`, with a reason naming the issuance. A lost tool must not
 *     be issuable, and "retired" with an audit trail is the honest terminal state
 *     for something that is not coming back.
 */
const RETURN_CONDITIONS = ["good", "damaged", "needs_service", "lost"];

/** Which administrative status a return condition leaves the tool in. Decision above. */
const STATUS_AFTER_RETURN = {
  good: "available",
  damaged: "in_service",
  needs_service: "in_service",
  lost: "retired",
};

/** Broad kinds, so the registry can be filtered without free-text matching. */
const TOOL_CATEGORIES = ["hand_tool", "powered_hand_tool", "machinery", "vehicle", "ppe", "measuring", "other"];

/**
 * The icons a tool may be given, as a CLOSED list.
 *
 * A registry of forty tools is scanned, not read, and one glyph per row is what makes
 * that possible — the category alone cannot tell a chainsaw from a drill.
 *
 * Closed rather than free text, and stored as these keys rather than as a CSS class,
 * for two reasons. A stored class name goes straight into a `class` attribute, which
 * makes an arbitrary string a styling injection; and a key survives the front end
 * changing icon library, which a class does not. The keys are the pillar's vocabulary
 * — mapping them to glyphs is the page's job (`CrewApi.TOOL_ICON_CHOICES`), the same
 * split as the status icons.
 *
 * Icon is OPTIONAL everywhere: a tool without one falls back to its category's glyph,
 * so this could be added without touching a single existing row.
 */
const TOOL_ICONS = [
  "wrench",
  "screwdriver",
  "hammer",
  "toolbox",
  "chainsaw",
  "tractor",
  "truck",
  "trailer",
  "oil_can",
  "sprayer",
  "seedling",
  "helmet",
  "vest",
  "ruler",
  "scale",
  "plug",
  "battery",
  "fire_extinguisher",
];

/**
 * How much notice a service gets before it is due.
 *
 * Fourteen days rather than sixty (the training pillar's window): booking a
 * workshop slot is a fortnight's problem, not a quarter's, and a `due_soon` that
 * lights up two months early is a `due_soon` that is permanently on.
 */
const DUE_SOON_DAYS = 14;

const numeric = (value) => Number(value);

/** Rows for one tool, oldest first. Ledger id order is append order (§6.6). */
function ledgerFor(issuances, toolId) {
  const id = numeric(toolId);
  return (issuances || []).filter((row) => numeric(row.toolId) === id).sort((a, b) => numeric(a.id) - numeric(b.id));
}

/** True when a row is still open — the tool has not come back. */
const isOpen = (issuance) => Boolean(issuance) && (issuance.returnedAt === null || issuance.returnedAt === undefined);

/**
 * The open issuance for a tool, or null.
 *
 * Implementation A of decision 1. Deliberately the naive one: find the row that
 * has not been closed. `replayLedger` is implementation B, and the property test
 * pits them against each other.
 *
 * `at most one` is an invariant the service enforces inside its write lock, not
 * something this function assumes — if a bug ever produced two open rows, the
 * LATEST is reported, because the most recent issue is the one somebody is holding
 * and the one a page needs to show.
 */
function currentIssuance(issuances, toolId) {
  const open = ledgerFor(issuances, toolId).filter(isOpen);
  return open.length === 0 ? null : open[open.length - 1];
}

/** The staff id currently holding a tool, or null. */
function currentHolderId(issuances, toolId) {
  const issuance = currentIssuance(issuances, toolId);
  return issuance ? numeric(issuance.staffId) : null;
}

/**
 * Replay the ledger as a time-ordered event stream. Implementation B of decision 1.
 *
 * Genuinely a different computation from `currentIssuance`, which is the only
 * reason having both is worth anything: this one ignores `returnedAt`-as-a-flag
 * and instead expands each row into an ISSUE event and, when closed, a RETURN
 * event, orders those events by their timestamps, and folds. So it answers "what
 * does the history say happened?" rather than "which row looks open?".
 *
 * `violations` is the useful by-product. A stream that issues a tool already held,
 * or returns one nobody holds, is a ledger that has been written wrongly — which
 * is exactly the shape of the double-issue bug §14.2 tests for. The property test
 * asserts both that the two implementations agree AND that the fold is clean, so a
 * ledger with two open rows for one tool fails loudly rather than resolving to a
 * plausible holder.
 *
 * @param {Array} issuances
 * @param {number|string} toolId
 * @returns {{ holder: number|null, issuanceId: number|null, violations: Array, events: number }}
 */
function replayLedger(issuances, toolId) {
  const rows = ledgerFor(issuances, toolId);

  const events = [];
  for (const row of rows) {
    events.push({ kind: "issue", at: row.issuedAt, id: numeric(row.id), staffId: numeric(row.staffId) });
    if (!isOpen(row)) {
      events.push({ kind: "return", at: row.returnedAt, id: numeric(row.id), staffId: numeric(row.staffId) });
    }
  }

  // Chronological, then by row id, then issue-before-return.
  //
  // The tie-breaks are not decoration: a fixed clock — which every test in this
  // module uses — stamps a return and the next issue with the SAME instant, so the
  // fold's correctness rests entirely on what happens when `at` is equal. Row id
  // second puts an earlier row's return ahead of a later row's issue, which is the
  // order they must have happened in for the ledger to be legal. Kind last orders a
  // single row's own two events, and it has to be issue-first: a row cannot be
  // returned before it was issued.
  events.sort((a, b) => {
    if (a.at !== b.at) return String(a.at) < String(b.at) ? -1 : 1;
    if (a.id !== b.id) return a.id - b.id;
    return a.kind === "issue" ? -1 : 1;
  });

  let holder = null;
  let issuanceId = null;
  const violations = [];

  for (const event of events) {
    if (event.kind === "issue") {
      if (holder !== null) {
        violations.push({ kind: "ISSUED_WHILE_HELD", issuanceId: event.id, heldBy: holder });
      }
      holder = event.staffId;
      issuanceId = event.id;
      continue;
    }
    if (holder === null) {
      violations.push({ kind: "RETURNED_WHILE_FREE", issuanceId: event.id });
      continue;
    }
    holder = null;
    issuanceId = null;
  }

  return { holder, issuanceId, violations, events: events.length };
}

/**
 * The day a tool's next service falls due, or null when it needs none.
 *
 * Decisions 4 and 5 both live in the two guards: no interval ⇒ no schedule at all,
 * and an interval with no `lastServicedOn` ⇒ a schedule whose due date is already
 * behind us.
 *
 * @param {object} tool - needs `serviceIntervalDays` and `lastServicedOn`
 * @returns {string|null} YYYY-MM-DD, the LAST day service may be done without
 *   being late; null when the tool has no service schedule
 */
function nextServiceDue(tool) {
  const interval = Number(tool?.serviceIntervalDays);
  // Decision 5.
  if (!Number.isFinite(interval) || interval <= 0) return null;
  // Decision 4: nothing to measure from. `serviceStatus` reads this as overdue.
  if (!tool.lastServicedOn) return null;
  return addDays(tool.lastServicedOn, interval);
}

/**
 * Where a tool sits against its service interval, on a given day (§8.5).
 *
 * @param {object} tool
 * @param {string} today - YYYY-MM-DD
 * @param {object} [options]
 * @param {number} [options.dueSoonDays]
 * @returns {"ok"|"due_soon"|"overdue"}
 */
function serviceStatus(tool, today, { dueSoonDays = DUE_SOON_DAYS } = {}) {
  const interval = Number(tool?.serviceIntervalDays);
  // Decision 5: no interval, nothing is ever due.
  if (!Number.isFinite(interval) || interval <= 0) return "ok";

  // Decision 4: an interval and no service history is overdue, not ok.
  if (!tool.lastServicedOn) return "overdue";

  const due = nextServiceDue(tool);
  const daysLeft = due === null ? null : daysBetween(today, due);
  // An unparseable date is the same kind of unknown as a missing one. Decision 4.
  if (daysLeft === null) return "overdue";

  // Decision 3's shape: due today is not yet late.
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= dueSoonDays) return "due_soon";
  return "ok";
}

/** Days until a tool's next service. Negative once past, null when it needs none. */
function daysUntilService(tool, today) {
  const due = nextServiceDue(tool);
  return due === null ? null : daysBetween(today, due);
}

/**
 * Whether an open issuance has run past its `dueBack` date. Decision 3.
 *
 * A closed row is never overdue — it came back, and whether it came back late is a
 * question about history, answered by `wasReturnedLate`.
 */
function isOverdueBack(issuance, today) {
  if (!isOpen(issuance) || !issuance.dueBack) return false;
  const daysLeft = daysBetween(today, issuance.dueBack);
  return daysLeft !== null && daysLeft < 0;
}

/** Days until an open issuance is due back. Negative once late, null when open-ended. */
function daysUntilDueBack(issuance, today) {
  if (!issuance?.dueBack) return null;
  return daysBetween(today, issuance.dueBack);
}

/** Whether a closed row came back after its due date. History, not a live alarm. */
function wasReturnedLate(issuance) {
  if (isOpen(issuance) || !issuance?.dueBack || !issuance.returnedAt) return false;
  return String(issuance.returnedAt).slice(0, 10) > issuance.dueBack;
}

/**
 * The status a tool actually has, ledger included (decision 1).
 *
 * Order is load-bearing, and possession comes FIRST. A tool marked retired in a
 * hand-edited store while somebody is still holding it should read as `on_issue`,
 * because that is the actionable fact — somebody has to bring it back before the
 * retirement means anything. The API cannot produce that combination (retiring a
 * tool that is out is refused), so this ordering only ever matters for a store
 * somebody edited, which is exactly when a useful answer is worth most.
 *
 * @param {object} tool
 * @param {Array} issuances - the whole ledger; this filters by tool itself
 * @returns {"available"|"on_issue"|"in_service"|"retired"}
 */
function effectiveStatus(tool, issuances) {
  if (currentIssuance(issuances, tool.id)) return "on_issue";
  if (tool.status === "retired") return "retired";
  if (tool.status === "in_service") return "in_service";
  return "available";
}

/** Every open issuance across the whole ledger, oldest first. */
function openIssuances(issuances) {
  return (issuances || []).filter(isOpen).sort((a, b) => numeric(a.id) - numeric(b.id));
}

/** Open issuances that have run past their due date, most overdue first. */
function overdueIssuances(issuances, today) {
  return openIssuances(issuances)
    .filter((row) => isOverdueBack(row, today))
    .sort((a, b) => (a.dueBack === b.dueBack ? numeric(a.id) - numeric(b.id) : String(a.dueBack).localeCompare(String(b.dueBack))));
}

/** The service records for one tool, most recent first. */
function serviceHistoryFor(serviceRecords, toolId) {
  const id = numeric(toolId);
  return (serviceRecords || [])
    .filter((row) => numeric(row.toolId) === id)
    .sort((a, b) =>
      a.servicedOn === b.servicedOn ? numeric(b.id) - numeric(a.id) : String(b.servicedOn).localeCompare(String(a.servicedOn)),
    );
}

module.exports = {
  TOOL_STATUSES,
  ADMIN_STATUSES,
  SERVICE_STATUSES,
  RETURN_CONDITIONS,
  STATUS_AFTER_RETURN,
  TOOL_CATEGORIES,
  TOOL_ICONS,
  DUE_SOON_DAYS,
  ledgerFor,
  isOpen,
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
  serviceHistoryFor,
};
