/**
 * Tools service (PRD §8.5) — who has the chainsaw, and is it due a service?
 *
 * Scoping lives here as it does in every pillar: every read filters by the
 * context's `userId` and every write stamps it, so a future transport cannot skip
 * isolation (§9).
 *
 * Four rules worth reading before changing anything.
 *
 *   1. **The holder is derived, never stored.** No write in this file puts a holder
 *      on a tool row. `ledger.js` answers "who has it" from the issuance ledger, and
 *      the stored `status` field carries only the administrative state. See decision
 *      1 in `ledger.js` for why one source of truth matters more here than the
 *      convenience of a cached field.
 *
 *   2. **The certification gate FAILS CLOSED, and it is a whitelist.** `issueTool`
 *      proceeds on exactly one value — `PERMITTED` — and refuses on everything
 *      else, including values it has never heard of. That shape is deliberate: a
 *      blacklist of known-bad outcomes would silently start passing the day the
 *      training pillar grows a fifth one. §8.5 says failing open here would be a
 *      safety bug, and the mistake it guards against is the natural one, an empty
 *      or missing answer read as "no objection".
 *
 *   3. **"Is it free?" and "append the row" happen inside one lock.** That is what
 *      makes two concurrent issues of one tool resolve to exactly one `ToolIssued`
 *      rather than usually one. `mutate` must stay synchronous — see `store.js`.
 *
 *   4. **Nothing is deleted.** A retired tool keeps its row, its ledger and its
 *      service history; `retireTool` sets a date and a reason. "Who had the
 *      chainsaw when it was lost?" has to stay answerable afterwards (§6.6).
 */
const { memberNotFound, CrewError, CREW_ERROR_CODES } = require("../../errors");
const { fromDateString, daysBetween } = require("../../clock");
const { getStore, read, transact } = require("./store");
const { eventFor } = require("./notifications");
const {
  TOOL_STATUSES,
  ADMIN_STATUSES,
  SERVICE_STATUSES,
  RETURN_CONDITIONS,
  STATUS_AFTER_RETURN,
  TOOL_CATEGORIES,
  TOOL_ICONS,
  DUE_SOON_DAYS,
  isOpen,
  currentIssuance,
  currentHolderId,
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
  ledgerFor,
} = require("./ledger");

/** `CHS-001`. Upper case, because an asset tag is stencilled on the thing. */
const ASSET_TAG_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{1,23}$/;

/** Course codes, matching the training pillar's own pattern — this is its handle. */
const COURSE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

const MAX_NAME = 120;
const MAX_LOCATION = 120;
const MAX_NOTE = 500;
/** Ten years. Longer than that is a typo, not a service interval. */
const MAX_SERVICE_INTERVAL_DAYS = 3650;
/** A tool cannot be booked out for longer than a season. */
const MAX_LOAN_DAYS = 365;

/**
 * A version conflict on a TOOL, not on a member.
 *
 * The shared `VersionConflict` type (declared by the profiles pillar) carries a
 * `staffId`, and a tool row has none — it belongs to the farm, not to a person. So
 * this pillar declares `ToolVersionConflict` and raises it with the same error code,
 * which keeps the code catalogue in §15 unchanged while the graph type says
 * something true.
 */
const toolVersionConflict = (toolId, expectedVersion, actualVersion) =>
  new CrewError(CREW_ERROR_CODES.VERSION_CONFLICT, `Tool ${toolId} has changed since it was read.`, {
    toolId: String(toolId),
    expectedVersion,
    actualVersion,
  });

function createToolsService(context, { store: storeOverride } = {}) {
  const store = storeOverride || getStore();
  const { userId, clock } = context;

  /** Everything this user owns, read once per request. */
  const own = context.addLoader("crewToolsDocument", async () => {
    context.onStoreRead("crewTools");
    const document = await read(store);
    const mine = (rows) => rows.filter((row) => Number(row.userId) === userId);
    return new Map([
      ["tools", mine(document.tools)],
      ["issuances", mine(document.issuances)],
      ["serviceRecords", mine(document.serviceRecords)],
    ]);
  });

  const ownedTools = async () => (await own.all()).get("tools");
  const ownedIssuances = async () => (await own.all()).get("issuances");
  const ownedServiceRecords = async () => (await own.all()).get("serviceRecords");

  const invalidate = () => context.resetLoaders("crewToolsDocument");

  const today = () => clock.today();

  /**
   * The member, or `MEMBER_NOT_FOUND`.
   *
   * Same read/write split as the other pillars (§12 rule 4): a member whose staff
   * record was deleted still has an issuance history worth reading, but nothing new
   * may be issued to them.
   */
  async function requireMember(staffId, { allowOrphaned = false } = {}) {
    const member = await context.services.profiles.findMember(staffId);
    if (!member) throw memberNotFound(staffId);
    if (!member.staff && !allowOrphaned) throw memberNotFound(staffId);
    return member;
  }

  /**
   * The certification gate (§8.5) — rule 2, and the most important function here.
   *
   * Returns one of three outcomes, and the caller may proceed on `PERMITTED` alone:
   *
   *   - `PERMITTED` — the tool needs no certification, or the member holds a live
   *     one. `expiring_soon` counts as live; the training pillar decides that, and
   *     grounding the crew for the length of the notice window every cycle would be
   *     the wrong answer;
   *   - `NOT_CERTIFIED` — the check ran and said no. `status` says why: null for
   *     never certified, `expired`, or `revoked`;
   *   - `CHECK_UNAVAILABLE` — the check could not be evaluated. The training pillar
   *     did not load, its service has no gate, it threw, it answered with something
   *     unreadable, or it reported `UNAVAILABLE` itself (no course answers the code,
   *     its store is unreadable). **Every one of these is a refusal.**
   *
   * The last branch is the one to preserve. It is written as a fall-through so an
   * outcome this gate has never seen refuses rather than passes — the fail-closed
   * property belongs to the whole function, not to any single `if`.
   */
  async function evaluateGate(tool, staffId) {
    const required = typeof tool.requiresCertification === "string" ? tool.requiresCertification.trim() : "";
    if (required.length === 0) return { outcome: "PERMITTED", requiredCertification: null, status: null, certification: null };

    // §16's checklist item: the gate must fail closed "when training is disabled".
    // With one module-level flag (§5.1.1) a pillar cannot be switched off
    // individually, but it CAN fail to load — the registry skips a pillar whose
    // require throws (§12 rule 6) — and then `context.services.training` is simply
    // absent. Absent must mean refused.
    const training = context.services.training;
    if (!training || typeof training.evaluateCertification !== "function") {
      return {
        outcome: "CHECK_UNAVAILABLE",
        reason: "TRAINING_UNAVAILABLE",
        requiredCertification: required,
        detail: `This tool requires the "${required}" certification, and training records are not available to check it against.`,
      };
    }

    let evaluation;
    try {
      evaluation = await training.evaluateCertification(staffId, required);
    } catch (error) {
      return {
        outcome: "CHECK_UNAVAILABLE",
        reason: "CHECK_FAILED",
        requiredCertification: required,
        detail: `The certification check could not be completed: ${error.message}`,
      };
    }

    if (!evaluation || typeof evaluation.outcome !== "string") {
      return {
        outcome: "CHECK_UNAVAILABLE",
        reason: "CHECK_FAILED",
        requiredCertification: required,
        detail: "The certification check returned nothing this gate could read.",
      };
    }

    if (evaluation.outcome === "PERMITTED") {
      return {
        outcome: "PERMITTED",
        requiredCertification: required,
        status: evaluation.status ?? null,
        certification: evaluation.certification ?? null,
      };
    }

    if (evaluation.outcome === "NOT_CERTIFIED") {
      return {
        outcome: "NOT_CERTIFIED",
        requiredCertification: required,
        status: evaluation.status ?? null,
        certification: evaluation.certification ?? null,
      };
    }

    // `UNAVAILABLE`, and anything else. Rule 2: refuse.
    return {
      outcome: "CHECK_UNAVAILABLE",
      reason: evaluation.reason || "CHECK_UNAVAILABLE",
      requiredCertification: required,
      detail: evaluation.detail ?? `The "${required}" certification could not be checked.`,
    };
  }

  const service = {
    TOOL_STATUSES,
    ADMIN_STATUSES,
    SERVICE_STATUSES,
    RETURN_CONDITIONS,
    TOOL_CATEGORIES,
    DUE_SOON_DAYS,

    // --- the registry ------------------------------------------------------

    /**
     * The tool registry, filtered (§8.5).
     *
     * Retired tools are hidden unless asked for, the same way `crew.html` hides
     * `ENDED` members (§10.1): a registry that lists every hand tool the farm has
     * ever owned buries the ones somebody might actually pick up. Asking for
     * `status: "retired"` shows them, and so does `includeRetired`.
     */
    async listTools({ status, category, serviceStatus: wantedServiceStatus, includeRetired = false } = {}) {
      const tools = await ownedTools();
      const issuances = await ownedIssuances();
      const day = today();
      const showRetired = includeRetired || status === "retired";

      return tools
        .filter((tool) => (showRetired ? true : effectiveStatus(tool, issuances) !== "retired"))
        .filter((tool) => (status ? effectiveStatus(tool, issuances) === status : true))
        .filter((tool) => (category ? tool.category === category : true))
        .filter((tool) => (wantedServiceStatus ? serviceStatus(tool, day) === wantedServiceStatus : true))
        .slice()
        .sort((a, b) => String(a.assetTag).localeCompare(String(b.assetTag)));
    },

    async findTool(toolId) {
      const id = Number(toolId);
      if (!Number.isInteger(id)) return null;
      return (await ownedTools()).find((row) => Number(row.id) === id) || null;
    },

    async findToolByAssetTag(assetTag) {
      if (typeof assetTag !== "string") return null;
      const tag = assetTag.trim().toUpperCase();
      return (await ownedTools()).find((row) => String(row.assetTag).toUpperCase() === tag) || null;
    },

    /**
     * Add a tool to the registry.
     *
     * `requiresCertification` is NOT checked against the course list, and that is
     * deliberate rather than an omission: §8.5 already says a code no course answers
     * to makes the gate return `CertificationCheckUnavailable`. So registering a
     * chainsaw before the chainsaw course exists is legal, and the consequence is
     * that the chainsaw cannot be issued until it does — refused, never allowed.
     * Validating here instead would force the two stores to be populated in one
     * particular order for no safety gain.
     */
    async registerTool(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateToolInput(input, { today: today() });
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const assetTag = String(input.assetTag).trim().toUpperCase();
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        // An asset tag is the handle a person uses — it is stencilled on the tool —
        // so two tools answering to one tag would make every "issue CHS-001" request
        // ambiguous.
        const taken = document.tools.some((row) => Number(row.userId) === userId && String(row.assetTag).toUpperCase() === assetTag);
        if (taken) {
          return {
            document,
            result: {
              outcome: "VALIDATION_FAILED",
              fieldErrors: [{ field: "assetTag", message: `Asset tag "${assetTag}" is already in use.` }],
            },
          };
        }

        const nextId = document.counters.lastToolId + 1;
        const tool = {
          id: nextId,
          userId,
          assetTag,
          name: String(input.name).trim(),
          category: normaliseCategory(input.category),
          icon: normaliseIcon(input.icon),
          requiresCertification: normaliseCourseCode(input.requiresCertification),
          serviceIntervalDays: normaliseInterval(input.serviceIntervalDays),
          lastServicedOn: input.lastServicedOn ?? null,
          // Rule 1: administrative status only. `on_issue` is computed.
          status: "available",
          storageLocation: input.storageLocation ?? null,
          retiredOn: null,
          retiredReason: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        };

        return {
          document: {
            ...document,
            tools: [...document.tools, tool],
            counters: { ...document.counters, lastToolId: nextId },
          },
          result: { outcome: "REGISTERED", tool },
        };
      });

      if (result.outcome === "REGISTERED") invalidate();
      return result;
    },

    // --- the issuance ledger -----------------------------------------------

    /**
     * Issue a tool to a crew member (§8.5).
     *
     * The order of the refusals matters. Availability is checked BEFORE the
     * certification gate, so a tool somebody else is already holding reports
     * `UNAVAILABLE` rather than sending the caller to book a course they may not
     * need — and so the training store is not read at all for a tool that could not
     * go out anyway. Then the gate (rule 2). Then, inside the lock, availability is
     * checked AGAIN against the document the append will be written to, which is
     * what rule 3 buys: the pre-flight check is a courtesy, the in-lock one is the
     * guarantee.
     */
    async issueTool(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateIssueInput(input, { today: today() });
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      // Throws MEMBER_NOT_FOUND for an unknown, unowned or orphaned staff id.
      await requireMember(input.staffId);

      const tool = await service.findTool(input.toolId);
      // §8.5's union has no `ToolNotFound` member, and folding "no such tool" into
      // `UNAVAILABLE` is the right answer rather than a workaround: a tool the caller
      // cannot see is a tool they cannot have, and saying so without confirming
      // whether it exists matches how `MEMBER_NOT_FOUND` treats existence (§9).
      if (!tool) return { outcome: "UNAVAILABLE", reason: "NOT_FOUND", toolId: String(input.toolId), tool: null, currentHolder: null };

      const issuances = await ownedIssuances();
      const preflight = effectiveStatus(tool, issuances);
      if (preflight !== "available") {
        return {
          outcome: "UNAVAILABLE",
          reason: preflight.toUpperCase(),
          toolId: String(tool.id),
          tool,
          currentHolder: currentHolderId(issuances, tool.id),
        };
      }

      const gate = await evaluateGate(tool, input.staffId);
      if (gate.outcome === "NOT_CERTIFIED") {
        return {
          outcome: "REQUIRES_CERTIFICATION",
          tool,
          requiredCertification: gate.requiredCertification,
          certificationStatus: gate.status,
          certification: gate.certification,
        };
      }
      if (gate.outcome !== "PERMITTED") {
        // Rule 2. Note this is `!== "PERMITTED"`, not `=== "CHECK_UNAVAILABLE"`.
        return {
          outcome: "CHECK_UNAVAILABLE",
          tool,
          requiredCertification: gate.requiredCertification,
          reason: gate.reason || "CHECK_UNAVAILABLE",
          detail: gate.detail ?? null,
        };
      }

      const nowIso = clock.nowIso();
      const numericStaffId = Number(input.staffId);
      const numericToolId = Number(tool.id);

      const result = await transact(store, (document) => {
        const mineTools = document.tools.filter((row) => Number(row.userId) === userId);
        const mineIssuances = document.issuances.filter((row) => Number(row.userId) === userId);

        const current = mineTools.find((row) => Number(row.id) === numericToolId);
        if (!current) {
          return {
            document,
            result: { outcome: "UNAVAILABLE", reason: "NOT_FOUND", toolId: String(numericToolId), tool: null, currentHolder: null },
          };
        }

        // Rule 3: THE guarantee. Two concurrent issues both reach here; the second
        // one sees the first one's row and refuses.
        const status = effectiveStatus(current, mineIssuances);
        if (status !== "available") {
          return {
            document,
            result: {
              outcome: "UNAVAILABLE",
              reason: status.toUpperCase(),
              toolId: String(numericToolId),
              tool: current,
              currentHolder: currentHolderId(mineIssuances, numericToolId),
            },
          };
        }

        const nextId = document.counters.lastIssuanceId + 1;
        const issuance = {
          id: nextId,
          userId,
          toolId: numericToolId,
          staffId: numericStaffId,
          issuedAt: nowIso,
          dueBack: input.dueBack,
          returnedAt: null,
          conditionOnReturn: null,
          note: input.note ?? null,
          createdAt: nowIso,
        };

        // Rule 1: the tool row learns NOTHING about who has it. `updatedAt` moves
        // because the row was touched; `version` does not, because nothing a caller
        // could hold an `expectedVersion` against has changed — possession is a fact
        // about the ledger.
        const tools = mapRow(
          document.tools,
          (row) => Number(row.id) === numericToolId && Number(row.userId) === userId,
          (row) => ({
            ...row,
            updatedAt: nowIso,
          }),
        );

        return {
          document: {
            ...document,
            tools,
            issuances: [...document.issuances, issuance],
            counters: { ...document.counters, lastIssuanceId: nextId },
          },
          result: { outcome: "ISSUED", issuance, tool: tools.find((row) => Number(row.id) === numericToolId) },
        };
      });

      if (result.outcome === "ISSUED") {
        invalidate();
        context.notifier.publishEvent(eventFor(result));
      }
      return result;
    },

    /**
     * Take a tool back, recording the state it came back in (§8.5).
     *
     * The condition is not decoration: it decides whether the tool goes back on the
     * shelf or off the run. `damaged` and `needs_service` leave it `in_service`, so
     * it cannot be issued again until somebody records a service — and `lost`
     * retires it, because a tool that is not coming back must not be issuable and
     * "retired, reason: lost on issuance 12" is the honest way to say so.
     */
    async returnTool(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateReturnInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const numericToolId = Number(input.toolId);
      const condition = String(input.condition).toLowerCase();
      const nowIso = clock.nowIso();
      const day = today();

      const result = await transact(store, (document) => {
        const mineIssuances = document.issuances.filter((row) => Number(row.userId) === userId);
        const tool = document.tools.find((row) => Number(row.id) === numericToolId && Number(row.userId) === userId);
        if (!tool) return { document, result: { outcome: "NOT_FOUND", toolId: String(input.toolId) } };

        const open = currentIssuance(mineIssuances, numericToolId);
        if (!open) {
          return {
            document,
            result: { outcome: "NOT_ON_ISSUE", toolId: String(numericToolId), tool, status: effectiveStatus(tool, mineIssuances) },
          };
        }

        // The one in-place write the ledger allows, and it happens once: closing a
        // row. Nothing ever writes `returnedAt` again (§6.6, decision 2).
        const closed = {
          ...open,
          returnedAt: nowIso,
          conditionOnReturn: condition,
          returnNote: input.note ?? null,
        };
        const issuances = mapRow(
          document.issuances,
          (row) => Number(row.id) === Number(open.id) && Number(row.userId) === userId,
          () => closed,
        );

        const nextStatus = STATUS_AFTER_RETURN[condition] || "available";
        const tools = mapRow(
          document.tools,
          (row) => Number(row.id) === numericToolId && Number(row.userId) === userId,
          (row) => ({
            ...row,
            status: nextStatus,
            retiredOn: nextStatus === "retired" ? day : row.retiredOn,
            retiredReason:
              nextStatus === "retired" ? `Lost on issuance ${open.id}${input.note ? ` — ${input.note}` : ""}` : row.retiredReason,
            updatedAt: nowIso,
            version: Number(row.version) + 1,
          }),
        );

        return {
          document: { ...document, tools, issuances },
          result: {
            outcome: "RETURNED",
            issuance: closed,
            tool: tools.find((row) => Number(row.id) === numericToolId),
            late: wasReturnedLate(closed),
          },
        };
      });

      if (result.outcome === "RETURNED") {
        invalidate();
        context.notifier.publishEvent(eventFor(result));
      }
      return result;
    },

    // --- the service schedule ----------------------------------------------

    /**
     * Record that a tool was serviced.
     *
     * Two guards that look fussy and are not. A tool that is OUT cannot be
     * serviced — you do not have it — and letting it through would reset a service
     * clock on the strength of a form somebody filled in optimistically. And a
     * BACKDATED record never moves `lastServicedOn` backwards: filing April's
     * paperwork in July must not make a tool serviced in June look overdue.
     */
    async recordService(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateServiceInput(input, { today: today() });
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const numericToolId = Number(input.toolId);
      const servicedOn = input.servicedOn ?? today();
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const mineIssuances = document.issuances.filter((row) => Number(row.userId) === userId);
        const tool = document.tools.find((row) => Number(row.id) === numericToolId && Number(row.userId) === userId);
        if (!tool) return { document, result: { outcome: "NOT_FOUND", toolId: String(input.toolId) } };

        const status = effectiveStatus(tool, mineIssuances);
        if (status === "on_issue" || status === "retired") {
          return {
            document,
            result: {
              outcome: "NOT_SERVICEABLE",
              toolId: String(numericToolId),
              tool,
              status,
              currentHolder: currentHolderId(mineIssuances, numericToolId),
            },
          };
        }

        assertVersion(input, tool);

        const nextId = document.counters.lastServiceRecordId + 1;
        const record = {
          id: nextId,
          userId,
          toolId: numericToolId,
          servicedOn,
          performedBy: input.performedBy ?? null,
          note: input.note ?? null,
          createdAt: nowIso,
        };

        // Never backwards.
        const lastServicedOn = tool.lastServicedOn && tool.lastServicedOn > servicedOn ? tool.lastServicedOn : servicedOn;

        const tools = mapRow(
          document.tools,
          (row) => Number(row.id) === numericToolId && Number(row.userId) === userId,
          (row) => ({
            ...row,
            lastServicedOn,
            // A serviced tool comes off the run and back onto the shelf. `retired` is
            // never reached from here — it is refused above.
            status: "available",
            updatedAt: nowIso,
            version: Number(row.version) + 1,
          }),
        );

        return {
          document: {
            ...document,
            tools,
            serviceRecords: [...document.serviceRecords, record],
            counters: { ...document.counters, lastServiceRecordId: nextId },
          },
          result: { outcome: "SERVICED", record, tool: tools.find((row) => Number(row.id) === numericToolId) },
        };
      });

      if (result.outcome === "SERVICED") invalidate();
      return result;
    },

    /**
     * Take a tool out of service permanently. Terminal (rule 4).
     *
     * A tool that is OUT cannot be retired: it has to come back first, and a
     * `lost` return is the path for one that will not. Retiring it while somebody
     * held it would strand an open ledger row against a tool nobody is watching for.
     */
    async retireTool(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateRetireInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const numericToolId = Number(input.toolId);
      const reason = String(input.reason).trim();
      const nowIso = clock.nowIso();
      const day = today();

      const result = await transact(store, (document) => {
        const mineIssuances = document.issuances.filter((row) => Number(row.userId) === userId);
        const tool = document.tools.find((row) => Number(row.id) === numericToolId && Number(row.userId) === userId);
        if (!tool) return { document, result: { outcome: "NOT_FOUND", toolId: String(input.toolId) } };

        if (tool.status === "retired") {
          return {
            document,
            result: {
              outcome: "ALREADY_RETIRED",
              toolId: String(numericToolId),
              retiredOn: tool.retiredOn ?? null,
              retiredReason: tool.retiredReason ?? null,
            },
          };
        }

        if (currentIssuance(mineIssuances, numericToolId)) {
          return {
            document,
            result: {
              outcome: "ON_ISSUE",
              toolId: String(numericToolId),
              tool,
              currentHolder: currentHolderId(mineIssuances, numericToolId),
            },
          };
        }

        assertVersion(input, tool);

        const tools = mapRow(
          document.tools,
          (row) => Number(row.id) === numericToolId && Number(row.userId) === userId,
          (row) => ({
            ...row,
            status: "retired",
            retiredOn: day,
            retiredReason: reason,
            updatedAt: nowIso,
            version: Number(row.version) + 1,
          }),
        );

        return {
          document: { ...document, tools },
          result: { outcome: "RETIRED", tool: tools.find((row) => Number(row.id) === numericToolId) },
        };
      });

      if (result.outcome === "RETIRED") invalidate();
      return result;
    },

    // --- reads the graph needs ---------------------------------------------

    /** Tools somebody is holding right now (§8.5). */
    async toolsOnIssue() {
      const tools = await ownedTools();
      const issuances = await ownedIssuances();
      return tools
        .filter((tool) => currentIssuance(issuances, tool.id))
        .sort((a, b) => String(a.assetTag).localeCompare(String(b.assetTag)));
    },

    /** Open issuances past their due date, most overdue first (§8.5). */
    async overdueReturns() {
      return overdueIssuances(await ownedIssuances(), today());
    },

    /** Every open issuance, whether late or not. */
    async listOpenIssuances() {
      return openIssuances(await ownedIssuances());
    },

    /**
     * One member's issuances.
     *
     * `open: true` is the ToolSummary's `onIssue`; `overdue: true` narrows it to the
     * ones that are late. History (closed rows) comes back newest first, because
     * "what did they have last week" is read from the top.
     */
    async issuancesFor(staffId, { open, overdue } = {}) {
      const rows = (await ownedIssuances()).filter((row) => Number(row.staffId) === Number(staffId));
      const day = today();

      if (overdue) return rows.filter((row) => isOverdueBack(row, day)).sort((a, b) => String(a.dueBack).localeCompare(String(b.dueBack)));
      if (open) return rows.filter(isOpen).sort((a, b) => Number(a.id) - Number(b.id));
      return rows.slice().sort((a, b) => Number(b.id) - Number(a.id));
    },

    /** The whole ledger for one tool, oldest first. Append-only, so this is history. */
    async ledgerForTool(toolId) {
      return ledgerFor(await ownedIssuances(), toolId);
    },

    async findIssuance(issuanceId) {
      const id = Number(issuanceId);
      if (!Number.isInteger(id)) return null;
      return (await ownedIssuances()).find((row) => Number(row.id) === id) || null;
    },

    /** The service records for one tool, most recent first. */
    async serviceHistory(toolId) {
      return serviceHistoryFor(await ownedServiceRecords(), toolId);
    },

    // Computed properties, exposed so resolvers never re-derive them a second way.

    /** The tool's status with the ledger overlaid — rule 1. */
    async statusOf(tool) {
      return effectiveStatus(tool, await ownedIssuances());
    },

    async currentIssuanceOf(tool) {
      return currentIssuance(await ownedIssuances(), tool.id);
    },

    serviceStatusOf(tool) {
      return serviceStatus(tool, today());
    },

    nextServiceDueOf(tool) {
      return nextServiceDue(tool);
    },

    daysUntilServiceOf(tool) {
      return daysUntilService(tool, today());
    },

    isOverdueBackOf(issuance) {
      return isOverdueBack(issuance, today());
    },

    daysUntilDueBackOf(issuance) {
      return daysUntilDueBack(issuance, today());
    },

    wasReturnedLateOf(issuance) {
      return wasReturnedLate(issuance);
    },

    /**
     * Whether this member could be issued this tool right now, and why not.
     *
     * The gate, asked without writing anything — so a page can grey out a button
     * instead of offering it and then refusing. It reuses `evaluateGate`, so there is
     * exactly one implementation of the rule and a UI cannot drift from the mutation.
     */
    async checkCertification(tool, staffId) {
      return evaluateGate(tool, staffId);
    },

    /** Rows referencing a staff member who no longer exists (§12 rule 4). */
    async findOrphanedOverlays() {
      const staffRecords = await context.loaders.ownedStaff.get();
      const live = new Set(staffRecords.map((staff) => Number(staff.id)));

      const orphans = [];
      for (const issuance of await ownedIssuances()) {
        if (live.has(Number(issuance.staffId))) continue;
        orphans.push({
          staffId: String(issuance.staffId),
          rowId: String(issuance.id),
          detail: `Issuance ${issuance.id} of tool ${issuance.toolId} references a deleted staff record${
            isOpen(issuance) ? " and is still open" : ""
          }.`,
        });
      }
      return orphans;
    },
  };

  return service;
}

// --- helpers ----------------------------------------------------------------

/** Replace the rows a predicate matches, leaving the rest identical. */
function mapRow(rows, matches, update) {
  return rows.map((row) => (matches(row) ? update(row) : row));
}

/** Throw `ToolVersionConflict` when the caller's `expectedVersion` is stale. */
function assertVersion(input, tool) {
  if (input.expectedVersion === undefined || input.expectedVersion === null) return;
  if (Number(input.expectedVersion) !== Number(tool.version)) {
    throw toolVersionConflict(tool.id, Number(input.expectedVersion), Number(tool.version));
  }
}

const normaliseCategory = (value) => {
  const category = typeof value === "string" ? value.toLowerCase() : "";
  return TOOL_CATEGORIES.includes(category) ? category : "other";
};

/**
 * An icon key, or null.
 *
 * Unlike `normaliseCategory`, an unrecognised value becomes NULL rather than a
 * default: there is no "other" glyph worth showing, and a tool with no icon already
 * falls back to its category. The validator rejects unknown values before this runs,
 * so the null here is the belt to that braces — and the reason a stored icon can only
 * ever be a member of `TOOL_ICONS`, which is what makes it safe to render as a class.
 */
const normaliseIcon = (value) => {
  const icon = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TOOL_ICONS.includes(icon) ? icon : null;
};

const normaliseCourseCode = (value) => {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return code.length === 0 ? null : code;
};

const normaliseInterval = (value) => {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  return Math.trunc(interval);
};

const isDate = (value) => typeof value === "string" && fromDateString(value) !== null;

const push = (fieldErrors, field, message) => fieldErrors.push({ field, message });

/** A tool for the registry (§6.5). */
function validateToolInput(input, { today } = {}) {
  const fieldErrors = [];
  if (!input || typeof input !== "object") {
    push(fieldErrors, "input", "A tool is required.");
    return fieldErrors;
  }

  const assetTag = typeof input.assetTag === "string" ? input.assetTag.trim().toUpperCase() : "";
  if (assetTag.length === 0) push(fieldErrors, "assetTag", "An asset tag is required.");
  else if (!ASSET_TAG_PATTERN.test(assetTag)) {
    push(fieldErrors, "assetTag", "An asset tag is 2–24 characters of letters, digits, dot, slash, dash or underscore.");
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) push(fieldErrors, "name", "A name is required.");
  else if (name.length > MAX_NAME) push(fieldErrors, "name", `A name is at most ${MAX_NAME} characters.`);

  if (input.category !== undefined && input.category !== null) {
    const category = String(input.category).toLowerCase();
    if (!TOOL_CATEGORIES.includes(category)) push(fieldErrors, "category", `Unknown category "${input.category}".`);
  }

  // The graph's `ToolIcon` enum already refuses anything not on the list, so this is
  // for the service's other caller — the seed, and any test that calls it directly.
  // An icon that reached storage unchecked would be rendered as a CSS class.
  if (input.icon !== undefined && input.icon !== null && String(input.icon).trim() !== "") {
    const icon = String(input.icon).trim().toLowerCase();
    if (!TOOL_ICONS.includes(icon)) push(fieldErrors, "icon", `Unknown icon "${input.icon}".`);
  }

  if (
    input.requiresCertification !== undefined &&
    input.requiresCertification !== null &&
    String(input.requiresCertification).trim() !== ""
  ) {
    const code = String(input.requiresCertification).trim().toLowerCase();
    // Shape only — whether a course answers to it is the gate's business, not this
    // validator's. See the note on `registerTool`.
    if (!COURSE_CODE_PATTERN.test(code)) {
      push(fieldErrors, "requiresCertification", "A course code is lower_snake_case, 2–40 characters.");
    }
  }

  if (input.serviceIntervalDays !== undefined && input.serviceIntervalDays !== null) {
    const interval = Number(input.serviceIntervalDays);
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_SERVICE_INTERVAL_DAYS) {
      push(fieldErrors, "serviceIntervalDays", `A service interval is 1–${MAX_SERVICE_INTERVAL_DAYS} whole days, or omitted.`);
    }
  }

  if (input.lastServicedOn !== undefined && input.lastServicedOn !== null) {
    if (!isDate(input.lastServicedOn)) push(fieldErrors, "lastServicedOn", "A service date is YYYY-MM-DD.");
    else if (today && input.lastServicedOn > today) push(fieldErrors, "lastServicedOn", "A tool cannot have been serviced in the future.");
  }

  if (input.storageLocation !== undefined && input.storageLocation !== null && String(input.storageLocation).length > MAX_LOCATION) {
    push(fieldErrors, "storageLocation", `A storage location is at most ${MAX_LOCATION} characters.`);
  }

  return fieldErrors;
}

/**
 * An issue request.
 *
 * `dueBack` is REQUIRED, and that is the one opinion in this validator. An issuance
 * with no return date can never appear in `overdueReturns`, which is how a tool
 * quietly stops being anybody's problem — the report §8.5 asks for only works if
 * every row has a date to be late against.
 */
function validateIssueInput(input, { today } = {}) {
  const fieldErrors = [];
  if (!input || typeof input !== "object") {
    push(fieldErrors, "input", "An issue request is required.");
    return fieldErrors;
  }

  if (!Number.isInteger(Number(input.toolId))) push(fieldErrors, "toolId", "A tool id is required.");
  if (!Number.isInteger(Number(input.staffId))) push(fieldErrors, "staffId", "A staff id is required.");

  if (!isDate(input.dueBack)) {
    push(fieldErrors, "dueBack", "A due-back date is required, as YYYY-MM-DD.");
  } else if (today) {
    if (input.dueBack < today) push(fieldErrors, "dueBack", "A tool cannot be due back before it goes out.");
    else {
      const span = daysBetween(today, input.dueBack);
      if (span !== null && span > MAX_LOAN_DAYS)
        push(fieldErrors, "dueBack", `A tool cannot be booked out for more than ${MAX_LOAN_DAYS} days.`);
    }
  }

  if (input.note !== undefined && input.note !== null && String(input.note).length > MAX_NOTE) {
    push(fieldErrors, "note", `A note is at most ${MAX_NOTE} characters.`);
  }

  return fieldErrors;
}

function validateReturnInput(input) {
  const fieldErrors = [];
  if (!input || typeof input !== "object") {
    push(fieldErrors, "input", "A return is required.");
    return fieldErrors;
  }

  if (!Number.isInteger(Number(input.toolId))) push(fieldErrors, "toolId", "A tool id is required.");

  const condition = typeof input.condition === "string" ? input.condition.toLowerCase() : "";
  if (!RETURN_CONDITIONS.includes(condition)) {
    push(fieldErrors, "condition", `A return condition is one of ${RETURN_CONDITIONS.join(", ")}.`);
  }

  if (input.note !== undefined && input.note !== null && String(input.note).length > MAX_NOTE) {
    push(fieldErrors, "note", `A note is at most ${MAX_NOTE} characters.`);
  }

  return fieldErrors;
}

function validateServiceInput(input, { today } = {}) {
  const fieldErrors = [];
  if (!input || typeof input !== "object") {
    push(fieldErrors, "input", "A service record is required.");
    return fieldErrors;
  }

  if (!Number.isInteger(Number(input.toolId))) push(fieldErrors, "toolId", "A tool id is required.");

  if (input.servicedOn !== undefined && input.servicedOn !== null) {
    if (!isDate(input.servicedOn)) push(fieldErrors, "servicedOn", "A service date is YYYY-MM-DD.");
    else if (today && input.servicedOn > today) push(fieldErrors, "servicedOn", "A service cannot be recorded in the future.");
  }

  if (input.note !== undefined && input.note !== null && String(input.note).length > MAX_NOTE) {
    push(fieldErrors, "note", `A note is at most ${MAX_NOTE} characters.`);
  }

  return fieldErrors;
}

function validateRetireInput(input) {
  const fieldErrors = [];
  if (!input || typeof input !== "object") {
    push(fieldErrors, "input", "A retirement is required.");
    return fieldErrors;
  }

  if (!Number.isInteger(Number(input.toolId))) push(fieldErrors, "toolId", "A tool id is required.");
  // Terminal and irreversible, so the reason is the only record of why. §8.4's
  // revocation takes the same line for the same reason.
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    push(fieldErrors, "reason", "A retirement needs a reason.");
  }

  return fieldErrors;
}

module.exports = {
  createToolsService,
  validateToolInput,
  validateIssueInput,
  validateReturnInput,
  validateServiceInput,
  validateRetireInput,
  normaliseCategory,
  normaliseIcon,
  normaliseCourseCode,
  normaliseInterval,
  toolVersionConflict,
  ASSET_TAG_PATTERN,
  COURSE_CODE_PATTERN,
  MAX_SERVICE_INTERVAL_DAYS,
  MAX_LOAN_DAYS,
  // Re-exported so a caller has one import for the pillar's vocabulary.
  TOOL_STATUSES,
  ADMIN_STATUSES,
  SERVICE_STATUSES,
  RETURN_CONDITIONS,
  STATUS_AFTER_RETURN,
  TOOL_CATEGORIES,
  TOOL_ICONS,
  DUE_SOON_DAYS,
};
