/**
 * The crew graph endpoint (PRD §7.1, §7.3).
 *
 * Transport only: read the request, build a context, run the operation, write the
 * response. No domain logic and no scoping decisions — `req.user.userId` is
 * copied into the context here and never read again downstream, which is what
 * keeps identity from being re-derived (and possibly re-derived wrongly) deeper in.
 *
 * Status codes follow §7.3 exactly, and the distinction is the part worth
 * guarding: a query that failed to parse or validate returns **400 with no `data`
 * key**, while a query that ran and hit a resolver error returns **200 with both
 * `data` and `errors`**. `services/graphql/index.js` decides which; this file just
 * forwards it.
 */
const { runOperation, printSchemaWithHeader } = require("../services/graphql");
const { getCrewSchema, runFirstEnableSeeds } = require("../services/crew/registry");
const { createCrewContext } = require("../services/crew/context");
const { CREW_ERROR_CODES } = require("../services/crew/errors");
const { logError } = require("../helpers/logger-api");

// A document larger than this is refused before it is parsed. Cheap protection
// against a pathological query, and it bounds the work the parser can be asked
// to do (Phase 8 tightens the rest of the limits).
//
// Deliberately BELOW express.json()'s 100kb default: if the global body parser
// tripped first, the caller would get its error instead of a GraphQL-shaped one,
// and this endpoint's contract would depend on middleware it does not own.
const MAX_DOCUMENT_BYTES = 64 * 1024;

/** The error-catalogue header printed above the SDL, per §15. */
const SDL_HEADER = `Crew Office — GraphQL schema (assembled from the enabled pillars).

Every error carries extensions.code. The catalogue:
  GRAPHQL_PARSE_FAILED        syntax error                     400, no data key
  GRAPHQL_VALIDATION_FAILED   unknown field/type/argument       400, no data key
  QUERY_TOO_DEEP              depth guard tripped               400, no data key
  QUERY_TOO_COSTLY            cost guard tripped                400, no data key
  ${CREW_ERROR_CODES.MEMBER_NOT_FOUND.padEnd(27)} unknown OR not-owned staff id     200 + errors / union member
  ${CREW_ERROR_CODES.VERSION_CONFLICT.padEnd(27)} expectedVersion is stale          200 + union member
  ${CREW_ERROR_CODES.VALIDATION_FAILED.padEnd(27)} domain field validation           200 + union member
  ${CREW_ERROR_CODES.PROFILE_WRITE_FAILED.padEnd(27)} staff created, profile failed      200 + CrewMemberHiredWithoutProfile
  ${CREW_ERROR_CODES.CHECK_UNAVAILABLE.padEnd(27)} a cross-pillar check could not run 200 + union member
  ${CREW_ERROR_CODES.LEAVE_POLICY_MISSING.padEnd(27)} balance asked for before a policy  200 + errors, leave: null
  INTERNAL_ERROR              masked; carries a correlationId    200 + errors

This module can hire but never fire: there is no delete mutation of any kind.`;

/**
 * POST — run a query or mutation.
 */
async function executeCrewOperation(req, res) {
  try {
    // `Content-Type: application/json` is required so this endpoint is not a
    // CSRF-simple-request target: a form post cannot reach it.
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return res.status(415).json({
        errors: [
          {
            message: "Content-Type must be application/json.",
            extensions: { code: "UNSUPPORTED_MEDIA_TYPE" },
          },
        ],
      });
    }

    const body = req.body || {};
    const { query, variables, operationName } = body;

    if (typeof query === "string" && Buffer.byteLength(query, "utf8") > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({
        errors: [
          {
            message: `Query document exceeds ${MAX_DOCUMENT_BYTES} bytes.`,
            extensions: { code: "DOCUMENT_TOO_LARGE" },
          },
        ],
      });
    }

    if (variables !== undefined && variables !== null && (typeof variables !== "object" || Array.isArray(variables))) {
      return res.status(400).json({
        errors: [{ message: "`variables` must be an object.", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }],
      });
    }

    const { schema, pillars } = getCrewSchema();
    const context = createCrewContext({ userId: req.user.userId, pillars });

    // At most once per process, and only when a pillar's store does not exist yet,
    // so the roster is populated the first time anyone looks at it. Never runs
    // with the flag off — nothing here is reachable without passing the gate.
    await runFirstEnableSeeds(context);

    const { status, body: responseBody } = await runOperation({
      schema,
      source: query,
      variables,
      operationName,
      contextValue: context,
      // Echo the assembled pillar set and the store-read count, so a test can see
      // both the module's shape and its batching without a second call (§7.3).
      extensions: () => ({
        storeReads: context.storeReads.total,
        pillars: context.pillars,
      }),
    });

    return res.status(status).json(responseBody);
  } catch (error) {
    // Reaching here means the failure was outside execution — schema assembly or
    // context construction. Masked like any other unexpected error.
    logError("[crew-graphql] request failed before execution", {
      error: error instanceof Error ? error.stack || error.message : error,
    });
    return res.status(500).json({
      errors: [{ message: "Crew Office could not handle this request.", extensions: { code: "INTERNAL_ERROR" } }],
    });
  }
}

/**
 * GET — the SDL of the schema as currently assembled, as text/plain.
 *
 * Deliberately the real assembled schema rather than a checked-in copy: what a
 * tester reads is what their queries will be validated against.
 */
async function getCrewSdl(req, res) {
  try {
    const { sdl, pillars } = getCrewSchema();
    const header = `${SDL_HEADER}\n\nAssembled pillars: ${pillars.map((pillar) => pillar.name).join(", ")}`;
    res.type("text/plain").status(200).send(printSchemaWithHeader(sdl, header));
  } catch (error) {
    logError("[crew-graphql] SDL rendering failed", {
      error: error instanceof Error ? error.stack || error.message : error,
    });
    res.status(500).json({
      errors: [{ message: "Crew Office could not render its schema.", extensions: { code: "INTERNAL_ERROR" } }],
    });
  }
}

module.exports = { executeCrewOperation, getCrewSdl, MAX_DOCUMENT_BYTES, SDL_HEADER };
