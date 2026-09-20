/**
 * Tools resolvers (PRD §8.5).
 *
 * Thin, like the four pillars before it: take arguments, call the per-request
 * service, shape the answer into a union member. No scoping, no validation and no
 * certification logic here — those live in the service so a different transport
 * cannot skip them (§9).
 *
 * This file owns the pillar's two translations:
 *
 *   1. the usual case translation. The store speaks lower_snake_case
 *      (`"on_issue"`, `"powered_hand_tool"`, `"needs_service"`) because that is what
 *      §6.5 writes to disk; the graph speaks SCREAMING_CASE because that is what a
 *      GraphQL enum is;
 *   2. `toFailureReason`, which coerces an unrecognised gate reason to
 *      `CERTIFICATION_CHECK_UNAVAILABLE` rather than letting it through. That is not
 *      defensiveness for its own sake: a value outside the enum would make the whole
 *      field fail to serialise, and a refusal that arrives as a serialisation error
 *      is a refusal a client is liable to treat as a transport blip and retry. The
 *      gate's answer must survive the trip intact.
 *
 * `Tool.status` and `Tool.currentHolder` are resolvers rather than stored fields,
 * which is decision 1 in `ledger.js` showing up in the graph: possession is computed
 * from the ledger on every read.
 */
const { CrewError, CREW_ERROR_CODES } = require("../../errors");

/** `"ON_ISSUE"` → `"on_issue"`. Undefined and null pass through untouched. */
const toStoreEnum = (value) => (typeof value === "string" ? value.toLowerCase() : value);

/** `"on_issue"` → `"ON_ISSUE"`. */
const toGraphEnum = (value) => (typeof value === "string" ? value.toUpperCase() : value);

/** Every value `CertificationCheckFailure` declares. */
const FAILURE_REASONS = [
  "TRAINING_UNAVAILABLE",
  "COURSE_NOT_DEFINED",
  "STORE_UNREADABLE",
  "NO_COURSE_CODE",
  "CHECK_FAILED",
  "CERTIFICATION_CHECK_UNAVAILABLE",
];

/**
 * Coerce a gate reason onto the enum. Translation 2 above.
 *
 * The fallback is a refusal either way — every value in `CertificationCheckFailure`
 * means "could not be evaluated" — so collapsing an unknown reason loses a detail
 * and never loses the refusal.
 */
function toFailureReason(reason) {
  const value = toGraphEnum(reason);
  return FAILURE_REASONS.includes(value) ? value : "CERTIFICATION_CHECK_UNAVAILABLE";
}

/** Map a thrown CrewError onto a tools union member, or rethrow if not ours. */
function toUnionMember(error) {
  if (!(error instanceof CrewError)) throw error;

  if (error.code === CREW_ERROR_CODES.VALIDATION_FAILED) {
    return { __typename: "ToolValidationFailed", fieldErrors: error.extensions.fieldErrors || [] };
  }
  if (error.code === CREW_ERROR_CODES.VERSION_CONFLICT) {
    return {
      __typename: "ToolVersionConflict",
      toolId: String(error.extensions.toolId),
      expectedVersion: error.extensions.expectedVersion,
      actualVersion: error.extensions.actualVersion,
    };
  }
  // MEMBER_NOT_FOUND stays an error with a code (§15) unless the union names it —
  // `issueTool` does, and handles it itself.
  throw error;
}

/** A staff id → the CrewMember shape the core resolvers understand. */
function memberFor(staffId, context) {
  if (staffId === null || staffId === undefined) return null;
  return context.services.profiles.findMember(staffId);
}

function issueOutcome(result) {
  switch (result.outcome) {
    case "ISSUED":
      return { __typename: "ToolIssued", issuance: result.issuance, tool: result.tool };
    case "UNAVAILABLE":
      // No `tool` here — see the note on `ToolUnavailable` in schema.graphql.
      return {
        __typename: "ToolUnavailable",
        toolId: result.toolId,
        reason: toGraphEnum(result.reason),
        currentHolderId: result.currentHolder ?? null,
      };
    case "REQUIRES_CERTIFICATION":
      return {
        __typename: "ToolRequiresCertification",
        tool: result.tool,
        requiredCertification: result.requiredCertification,
        certificationStatus: result.certificationStatus ?? null,
      };
    case "CHECK_UNAVAILABLE":
      // §8.5's fail-closed outcome. It is a refusal that reached the client as data
      // rather than as an error, which is the whole reason it is in the union.
      return {
        __typename: "CertificationCheckUnavailable",
        tool: result.tool,
        requiredCertification: result.requiredCertification,
        failure: toFailureReason(result.reason),
        detail: result.detail ?? null,
      };
    default:
      return { __typename: "ToolValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function returnOutcome(result) {
  switch (result.outcome) {
    case "RETURNED":
      return { __typename: "ToolReturned", issuance: result.issuance, tool: result.tool, late: result.late };
    case "NOT_ON_ISSUE":
      return { __typename: "ToolNotOnIssue", toolId: result.toolId, tool: result.tool, status: toGraphEnum(result.status) };
    case "NOT_FOUND":
      return { __typename: "ToolNotFound", toolId: result.toolId };
    default:
      return { __typename: "ToolValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function serviceOutcome(result) {
  switch (result.outcome) {
    case "SERVICED":
      return { __typename: "ServiceRecorded", record: result.record, tool: result.tool };
    case "NOT_SERVICEABLE":
      return {
        __typename: "ToolNotServiceable",
        toolId: result.toolId,
        tool: result.tool,
        status: toGraphEnum(result.status),
        currentHolderId: result.currentHolder ?? null,
      };
    case "NOT_FOUND":
      return { __typename: "ToolNotFound", toolId: result.toolId };
    default:
      return { __typename: "ToolValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function retireOutcome(result) {
  switch (result.outcome) {
    case "RETIRED":
      return { __typename: "ToolRetired", tool: result.tool };
    case "ALREADY_RETIRED":
      return {
        __typename: "ToolAlreadyRetired",
        toolId: result.toolId,
        retiredOn: result.retiredOn,
        retiredReason: result.retiredReason,
      };
    case "ON_ISSUE":
      return { __typename: "ToolStillOnIssue", toolId: result.toolId, tool: result.tool, currentHolderId: result.currentHolder ?? null };
    case "NOT_FOUND":
      return { __typename: "ToolNotFound", toolId: result.toolId };
    default:
      return { __typename: "ToolValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

/** The gate's answer, shaped for `CertificationCheck`. One function, two callers. */
function certificationCheck(gate) {
  if (gate.outcome === "PERMITTED") {
    return {
      permitted: true,
      requiredCertification: gate.requiredCertification ?? null,
      certificationStatus: gate.status ?? null,
      unavailableReason: null,
      message: null,
    };
  }
  if (gate.outcome === "NOT_CERTIFIED") {
    return {
      permitted: false,
      requiredCertification: gate.requiredCertification ?? null,
      certificationStatus: gate.status ?? null,
      unavailableReason: null,
      message: `This tool requires the "${gate.requiredCertification}" certification, which this member does not currently hold.`,
    };
  }
  return {
    permitted: false,
    requiredCertification: gate.requiredCertification ?? null,
    certificationStatus: null,
    unavailableReason: toFailureReason(gate.reason),
    message: gate.detail ?? "The certification for this tool could not be checked, so it cannot be issued.",
  };
}

const resolvers = {
  Query: {
    tools: (_source, { filter }, context) =>
      context.services.tools.listTools({
        status: toStoreEnum(filter?.status),
        category: toStoreEnum(filter?.category),
        serviceStatus: toStoreEnum(filter?.serviceStatus),
        includeRetired: filter?.includeRetired ?? false,
      }),

    tool: (_source, { id }, context) => context.services.tools.findTool(id),

    toolByAssetTag: (_source, { assetTag }, context) => context.services.tools.findToolByAssetTag(assetTag),

    toolsOnIssue: (_source, _args, context) => context.services.tools.toolsOnIssue(),

    overdueReturns: (_source, _args, context) => context.services.tools.overdueReturns(),

    openIssuances: (_source, _args, context) => context.services.tools.listOpenIssuances(),
  },

  Mutation: {
    registerTool: async (_source, { input }, context) => {
      try {
        const result = await context.services.tools.registerTool(input);
        if (result.outcome === "REGISTERED") return { __typename: "ToolRegistered", tool: result.tool };
        return { __typename: "ToolValidationFailed", fieldErrors: result.fieldErrors || [] };
      } catch (error) {
        return toUnionMember(error);
      }
    },

    issueTool: async (_source, { input }, context) => {
      try {
        return issueOutcome(await context.services.tools.issueTool(input));
      } catch (error) {
        // §8.5's union names `MemberNotFound`, so an unknown or unowned member is a
        // branchable outcome here rather than an error — the same shape
        // `enrollCrewMember` uses in the training pillar.
        if (error instanceof CrewError && error.code === CREW_ERROR_CODES.MEMBER_NOT_FOUND) {
          return { __typename: "MemberNotFound", staffId: String(error.extensions.staffId) };
        }
        return toUnionMember(error);
      }
    },

    returnTool: async (_source, { input }, context) => {
      try {
        return returnOutcome(await context.services.tools.returnTool(input));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    recordService: async (_source, { input }, context) => {
      try {
        return serviceOutcome(await context.services.tools.recordService(input));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    retireTool: async (_source, { toolId, reason, expectedVersion }, context) => {
      try {
        return retireOutcome(await context.services.tools.retireTool({ toolId, reason, expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },
  },

  // The pillar's one field on the join point. `source` is the CrewMember, passed
  // straight through — the summary's fields do the work lazily, so a query selecting
  // only `overdue` never builds the full history.
  CrewMember: {
    tools: (member) => ({ staffId: member.staffId }),
  },

  ToolSummary: {
    onIssue: (summary, _args, context) => context.services.tools.issuancesFor(summary.staffId, { open: true }),

    overdue: (summary, _args, context) => context.services.tools.issuancesFor(summary.staffId, { overdue: true }),

    history: async (summary, { limit }, context) => {
      const rows = await context.services.tools.issuancesFor(summary.staffId);
      const cap = limit === undefined || limit === null ? null : Math.max(0, Number(limit));
      return cap === null ? rows : rows.slice(0, cap);
    },

    /**
     * The gate, asked without writing. Null for a tool the caller cannot see —
     * "you may not issue a tool that does not exist" is not a certification answer,
     * and inventing a refusal reason for it would misdescribe why.
     */
    certificationCheck: async (summary, { toolId }, context) => {
      const tool = await context.services.tools.findTool(toolId);
      if (!tool) return null;
      return certificationCheck(await context.services.tools.checkCertification(tool, summary.staffId));
    },
  },

  Tool: {
    id: (tool) => String(tool.id),
    category: (tool) => toGraphEnum(tool.category),
    // Null for every tool registered before icons existed, and for any tool whose
    // owner did not pick one. The page falls back to the category's glyph.
    icon: (tool) => toGraphEnum(tool.icon) || null,
    // Computed through the service so there is exactly one implementation of each —
    // rule 1 in service.js, decision 1 in ledger.js.
    status: (tool, _args, context) => context.services.tools.statusOf(tool).then(toGraphEnum),
    serviceStatus: (tool, _args, context) => toGraphEnum(context.services.tools.serviceStatusOf(tool)),
    nextServiceDue: (tool, _args, context) => context.services.tools.nextServiceDueOf(tool),
    daysUntilService: (tool, _args, context) => context.services.tools.daysUntilServiceOf(tool),
    currentIssuance: (tool, _args, context) => context.services.tools.currentIssuanceOf(tool),
    currentHolder: async (tool, _args, context) => {
      const issuance = await context.services.tools.currentIssuanceOf(tool);
      return issuance ? memberFor(issuance.staffId, context) : null;
    },
    issuanceHistory: (tool, _args, context) => context.services.tools.ledgerForTool(tool.id),
    serviceHistory: (tool, _args, context) => context.services.tools.serviceHistory(tool.id),
  },

  Issuance: {
    id: (issuance) => String(issuance.id),
    staffId: (issuance) => String(issuance.staffId),
    tool: (issuance, _args, context) => context.services.tools.findTool(issuance.toolId),
    member: (issuance, _args, context) => memberFor(issuance.staffId, context),
    conditionOnReturn: (issuance) => toGraphEnum(issuance.conditionOnReturn) ?? null,
    isOverdueBack: (issuance, _args, context) => context.services.tools.isOverdueBackOf(issuance),
    daysUntilDueBack: (issuance, _args, context) => (issuance.returnedAt ? null : context.services.tools.daysUntilDueBackOf(issuance)),
    returnedLate: (issuance, _args, context) => context.services.tools.wasReturnedLateOf(issuance),
    note: (issuance) => issuance.note ?? null,
  },

  ServiceRecord: {
    id: (record) => String(record.id),
    tool: (record, _args, context) => context.services.tools.findTool(record.toolId),
  },

  // The three union members that report a holder carry a staff id from the service
  // and resolve it here, so a refusal costs no staff read unless the field is asked
  // for.
  ToolUnavailable: {
    currentHolder: (result, _args, context) => memberFor(result.currentHolderId, context),
  },
  ToolNotServiceable: {
    currentHolder: (result, _args, context) => memberFor(result.currentHolderId, context),
  },
  ToolStillOnIssue: {
    currentHolder: (result, _args, context) => memberFor(result.currentHolderId, context),
  },

  RegisterToolResult: { __resolveType: (value) => value.__typename },
  IssueToolResult: { __resolveType: (value) => value.__typename },
  ReturnToolResult: { __resolveType: (value) => value.__typename },
  RecordServiceResult: { __resolveType: (value) => value.__typename },
  RetireToolResult: { __resolveType: (value) => value.__typename },
};

module.exports = {
  resolvers,
  issueOutcome,
  returnOutcome,
  serviceOutcome,
  retireOutcome,
  certificationCheck,
  toFailureReason,
  toStoreEnum,
  toGraphEnum,
  FAILURE_REASONS,
};
