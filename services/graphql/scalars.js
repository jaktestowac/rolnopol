/**
 * Custom scalars for the crew graph (PRD §7.2).
 *
 * The one property every scalar here is written to guarantee is **coercion
 * parity**: a value passed as a variable and the same value written as a literal
 * must be accepted or rejected identically. `graphql-js` routes those through two
 * different functions (`parseValue` for variables, `parseLiteral` for literals),
 * and the classic bug is validating in one and not the other — so every scalar
 * below funnels both into ONE `coerce` function. That parity is what
 * `crew.graphql-scalars.test.js` sweeps.
 *
 * Nothing here is crew-specific: this layer knows about dates and strings, not
 * about staff. Any future graph module reuses it as-is.
 */
const { GraphQLScalarType, GraphQLError, Kind } = require("graphql");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STRING_LENGTH = 200;

/** A calendar date must survive a round trip — this is what rejects 2026-02-30. */
function isRealCalendarDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function fail(message, node) {
  throw new GraphQLError(message, node ? { nodes: node } : undefined);
}

/**
 * Build a scalar whose variable path and literal path cannot drift apart.
 *
 * @param {string} name
 * @param {string} description
 * @param {string[]} literalKinds - AST kinds this scalar accepts as a literal
 * @param {(value: unknown, node?: object) => unknown} coerce - the single gate
 * @param {(value: unknown) => unknown} [serialize] - outbound; defaults to coerce
 */
function makeScalar({ name, description, literalKinds, coerce, serialize }) {
  return new GraphQLScalarType({
    name,
    description,
    // Outbound. Stored values are already canonical, but a bug upstream should
    // surface as an error rather than as a malformed response.
    serialize: serialize || ((value) => coerce(value)),
    // Inbound as a variable.
    parseValue: (value) => coerce(value),
    // Inbound as a literal. The kind check is the only extra step — after it,
    // the exact same coerce runs, which is the whole point.
    parseLiteral: (node) => {
      if (!literalKinds.includes(node.kind)) {
        fail(`${name} must be written as ${literalKinds.join(" or ")}, got ${node.kind}.`, node);
      }
      const raw = node.kind === Kind.INT || node.kind === Kind.FLOAT ? Number(node.value) : node.value;
      return coerce(raw, node);
    },
  });
}

const GraphQLDate = makeScalar({
  name: "Date",
  description: "A calendar date as YYYY-MM-DD. No time, no zone — a day on the farm calendar.",
  literalKinds: [Kind.STRING],
  coerce: (value, node) => {
    if (typeof value !== "string") fail(`Date must be a string in YYYY-MM-DD form, got ${typeof value}.`, node);
    if (!DATE_PATTERN.test(value)) fail(`Date must match YYYY-MM-DD, got "${value}".`, node);
    if (!isRealCalendarDate(value)) fail(`Date "${value}" is not a real calendar date.`, node);
    return value;
  },
});

const GraphQLDateTime = makeScalar({
  name: "DateTime",
  description: "An instant as an ISO-8601 UTC string, e.g. 2026-07-29T06:10:00.000Z.",
  literalKinds: [Kind.STRING],
  coerce: (value, node) => {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) fail("DateTime received an invalid Date.", node);
      return value.toISOString();
    }
    if (typeof value !== "string") fail(`DateTime must be an ISO-8601 string, got ${typeof value}.`, node);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) fail(`DateTime "${value}" is not a valid ISO-8601 instant.`, node);
    // Canonicalise so two spellings of the same instant never diff.
    return parsed.toISOString();
  },
});

const GraphQLDays = makeScalar({
  name: "Days",
  description: "A non-negative number of days in half-day steps — 0, 0.5, 1, 1.5, ...",
  literalKinds: [Kind.INT, Kind.FLOAT],
  coerce: (value, node) => {
    const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num)) fail(`Days must be a finite number, got ${JSON.stringify(value)}.`, node);
    if (num < 0) fail(`Days must not be negative, got ${num}.`, node);
    // Half-day granularity is a domain rule: leave is booked in halves, never in
    // arbitrary fractions. Rejecting 0.3 here is cheaper than discovering it in
    // an accrual sum.
    if (Math.round(num * 2) !== num * 2) fail(`Days must be in 0.5 steps, got ${num}.`, node);
    return num;
  },
});

/**
 * `Days`, but allowed to go below zero.
 *
 * Exists because a leave balance genuinely can be negative: someone who books
 * October's holiday in July has committed days they have not yet accrued, and
 * `remaining = accrued + carriedOver − taken − booked` is then a negative number.
 * That is a true and useful statement — "you are ahead of your accrual" — and it
 * is the identity the leave pillar's invariant is defined by, so the type has to
 * be able to express it.
 *
 * Kept SEPARATE from `Days` rather than relaxing `Days`, because non-negativity
 * is exactly right for entitlement, accrued, taken and booked: a negative number
 * of days taken is a bug, and a scalar that tolerated it would stop catching one.
 */
const GraphQLSignedDays = makeScalar({
  name: "SignedDays",
  description: "A number of days in half-day steps, which may be negative — a balance can be overdrawn.",
  literalKinds: [Kind.INT, Kind.FLOAT],
  coerce: (value, node) => {
    const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num)) fail(`SignedDays must be a finite number, got ${JSON.stringify(value)}.`, node);
    if (Math.round(num * 2) !== num * 2) fail(`SignedDays must be in 0.5 steps, got ${num}.`, node);
    return num;
  },
});

const GraphQLNonEmptyString = makeScalar({
  name: "NonEmptyString",
  description: `A string with at least one non-whitespace character, at most ${MAX_STRING_LENGTH} characters. Trimmed on the way in.`,
  literalKinds: [Kind.STRING],
  coerce: (value, node) => {
    if (typeof value !== "string") fail(`NonEmptyString must be a string, got ${typeof value}.`, node);
    const trimmed = value.trim();
    if (trimmed.length === 0) fail("NonEmptyString must not be empty or whitespace-only.", node);
    if (trimmed.length > MAX_STRING_LENGTH) {
      fail(`NonEmptyString must be at most ${MAX_STRING_LENGTH} characters, got ${trimmed.length}.`, node);
    }
    return trimmed;
  },
  // Outbound stays lenient on length: an existing record longer than the cap
  // must still be readable. The cap guards INPUT, never the read path.
  serialize: (value) => {
    if (typeof value !== "string") fail(`NonEmptyString must serialize a string, got ${typeof value}.`);
    return value;
  },
});

const SCALARS = {
  Date: GraphQLDate,
  DateTime: GraphQLDateTime,
  Days: GraphQLDays,
  SignedDays: GraphQLSignedDays,
  NonEmptyString: GraphQLNonEmptyString,
};

// SDL for the scalar declarations, so a schema can be assembled from text.
const SCALAR_TYPE_DEFS = Object.keys(SCALARS)
  .map((name) => `scalar ${name}`)
  .join("\n");

module.exports = {
  SCALARS,
  SCALAR_TYPE_DEFS,
  MAX_STRING_LENGTH,
  GraphQLDate,
  GraphQLDateTime,
  GraphQLDays,
  GraphQLSignedDays,
  GraphQLNonEmptyString,
};
