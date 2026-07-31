/**
 * The execution wrapper (PRD §7.2, §7.3).
 *
 * parse → validate → execute, with the HTTP status decided by WHERE it stopped:
 *
 *   - a syntax or validation failure returns **400 with no `data` key at all**,
 *     because nothing was executed and `"data": null` would be a lie about a
 *     query that never ran;
 *   - an execution failure returns **200 with both `data` and `errors`**, which
 *     is the partial-success shape the spec asks for and the shape clients must
 *     learn to read.
 *
 * That distinction is the single most commonly mis-implemented part of a GraphQL
 * transport, so it is decided here once and asserted by test.
 *
 * Everything below is transport-shaped and domain-free: no crew concept appears.
 */
const { parse, validate, execute: executeDocument, specifiedRules, GraphQLError } = require("graphql");
const { createLimitRules, measure, DEFAULT_MAX_DEPTH, DEFAULT_MAX_COST } = require("./limits");
const { formatErrors, CODES } = require("./errors");

/**
 * Run one operation.
 *
 * @param {object} options
 * @param {import("graphql").GraphQLSchema} options.schema
 * @param {string} options.source - the query text
 * @param {object} [options.variables]
 * @param {string} [options.operationName]
 * @param {object} [options.contextValue] - passed through to every resolver
 * @param {{maxDepth?: number, maxCost?: number}} [options.limits]
 * @param {(result: object) => object} [options.extensions] - extra `extensions`
 * @returns {Promise<{status: number, body: object}>}
 */
async function runOperation({ schema, source, variables, operationName, contextValue, limits = {}, extensions }) {
  const startedAt = Date.now();
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxCost = limits.maxCost ?? DEFAULT_MAX_COST;

  if (typeof source !== "string" || source.trim() === "") {
    return {
      status: 400,
      body: {
        errors: [{ message: "A GraphQL query string is required.", extensions: { code: CODES.PARSE_FAILED } }],
      },
    };
  }

  // --- parse -----------------------------------------------------------------
  let document;
  try {
    document = parse(source);
  } catch (error) {
    return {
      status: 400,
      body: { errors: formatErrors([error], { defaultCode: CODES.PARSE_FAILED }) },
    };
  }

  // --- validate --------------------------------------------------------------
  // The limit rules are APPENDED to specifiedRules rather than replacing any of
  // them: every spec rule still runs, and ours run alongside.
  const rules = [...specifiedRules, ...createLimitRules({ maxDepth, maxCost })];
  const validationErrors = validate(schema, document, rules);
  if (validationErrors.length > 0) {
    return {
      status: 400,
      body: { errors: formatErrors(validationErrors, { defaultCode: CODES.VALIDATION_FAILED }) },
    };
  }

  // Measured after validation so the reported numbers describe a query that was
  // actually accepted — and so a rejected query is never charged for.
  const measured = measure(document, { operationName });

  // --- execute ---------------------------------------------------------------
  let result;
  try {
    result = await executeDocument({
      schema,
      document,
      contextValue,
      variableValues: variables || undefined,
      operationName: operationName || undefined,
    });
  } catch (error) {
    // Thrown rather than returned: an operation-level failure such as an unknown
    // operationName in a multi-operation document.
    return {
      status: 400,
      body: {
        errors: formatErrors([error instanceof GraphQLError ? error : new GraphQLError(error.message)], {
          defaultCode: CODES.VALIDATION_FAILED,
        }),
      },
    };
  }

  // Variable coercion happens INSIDE execute(), not validate() — so a query with
  // a variable of the wrong type comes back here with errors and NO `data` key at
  // all. That is a request error in the same class as a validation failure (the
  // operation never ran), so it gets the same 400 + no-`data` treatment. Keying on
  // the absence of `data` rather than on error text is what makes this robust.
  if (!("data" in result)) {
    return {
      status: 400,
      body: { errors: formatErrors(result.errors || [], { defaultCode: CODES.VALIDATION_FAILED }) },
    };
  }

  const body = {};
  // `data` is present whenever execution ran — including when it is null because
  // a non-null field failed. Its presence is the client's signal that the query
  // was valid.
  body.data = result.data;
  if (result.errors && result.errors.length > 0) body.errors = formatErrors(result.errors);

  const reported = {
    cost: measured.cost,
    depth: measured.depth,
    durationMs: Date.now() - startedAt,
    ...(extensions ? extensions(result) : {}),
  };
  body.extensions = reported;

  return { status: 200, body };
}

/** Print the SDL a caller would be executing against. */
function printSchemaWithHeader(sdl, header) {
  const comment = (header || "")
    .split("\n")
    .map((line) => `# ${line}`.trimEnd())
    .join("\n");
  return header ? `${comment}\n\n${sdl}\n` : `${sdl}\n`;
}

module.exports = { runOperation, printSchemaWithHeader, DEFAULT_MAX_DEPTH, DEFAULT_MAX_COST };
