/**
 * Depth and cost guards, as real validation rules (PRD §7.2).
 *
 * These are appended to `specifiedRules` and run inside `graphql-js`'s own
 * validation pass rather than as a bespoke pre-walk. That matters for two
 * reasons: fragment resolution and error shape come for free and are
 * spec-correct, and a rejected query fails the same way an unknown-field query
 * does — 400 with no `data` key.
 *
 * Both measures deliberately count the SAME way whether they are being used to
 * reject a query or to report `extensions.depth` / `extensions.cost` on a query
 * that passed, so the number a client sees is the number it was judged on.
 */
const { GraphQLError, Kind } = require("graphql");

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_COST = 1000;
// A list field costs its page size. Unpaginated list fields are charged this
// much, which is what stops `crew { nodes { ... } }` from looking free.
const DEFAULT_LIST_FACTOR = 10;

/**
 * Measure a document's depth and cost.
 *
 * Fragment spreads are followed (a query can hide its depth inside a fragment),
 * with a `seen` set so a cyclic fragment — which `NoFragmentCyclesRule` will
 * reject anyway — cannot spin here first.
 *
 * @param {object} document - parsed AST
 * @param {object} [options]
 * @param {(name: string) => object|undefined} [options.getFragment]
 * @param {string} [options.operationName]
 * @returns {{ depth: number, cost: number }}
 */
function measure(document, options = {}) {
  const fragments = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
  }
  const getFragment = options.getFragment || ((name) => fragments.get(name));
  const listFactor = options.listFactor ?? DEFAULT_LIST_FACTOR;

  let maxDepth = 0;
  let cost = 0;

  const walk = (selectionSet, depth, multiplier, seen) => {
    if (!selectionSet) return;
    if (depth > maxDepth) maxDepth = depth;

    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        // Introspection meta-fields are free: they are not domain work, and
        // charging for them would make the explorer's schema tab expensive.
        const isMeta = selection.name.value.startsWith("__");
        const pageSize = pageSizeOf(selection);
        const childMultiplier = pageSize === null ? multiplier : multiplier * pageSize;

        if (!isMeta) cost += multiplier;

        // An inner selection set means this field is (or may be) a list/object,
        // so its children are charged at the child multiplier.
        walk(selection.selectionSet, depth + 1, selection.selectionSet ? childMultiplier : multiplier, seen);
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        // An inline fragment is not a level of nesting of its own.
        walk(selection.selectionSet, depth, multiplier, seen);
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        if (seen.has(name)) continue; // cycle — NoFragmentCyclesRule reports it
        const fragment = getFragment(name);
        if (!fragment) continue; // unknown fragment — KnownFragmentNamesRule reports it
        const nextSeen = new Set(seen);
        nextSeen.add(name);
        walk(fragment.selectionSet, depth, multiplier, nextSeen);
      }
    }
  };

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    if (options.operationName && definition.name?.value !== options.operationName) continue;
    walk(definition.selectionSet, 1, 1, new Set());
  }

  return { depth: maxDepth, cost };
}

/**
 * A field's page size, taken from a literal `first` / `last` argument.
 * Returns `null` when the field is not paginated, so the caller can tell
 * "no multiplier" from "a page of 1".
 *
 * A variable page size cannot be read at validation time (variables are not
 * bound yet), so it is charged the default factor — the safe direction.
 */
function pageSizeOf(fieldNode, listFactor = DEFAULT_LIST_FACTOR) {
  const args = fieldNode.arguments || [];
  for (const arg of args) {
    if (arg.name.value !== "first" && arg.name.value !== "last") continue;
    if (arg.value.kind === Kind.INT) return Math.max(1, Number(arg.value.value));
    return listFactor; // variable or non-int: assume a full page
  }
  return null;
}

/**
 * Depth rule factory. Reported once per operation, with the operation's node so
 * `errors[].locations` points at the offending query.
 */
function createDepthRule(maxDepth = DEFAULT_MAX_DEPTH) {
  return function DepthLimitRule(context) {
    return {
      OperationDefinition(node) {
        const { depth } = measure({ definitions: [node] }, { getFragment: (name) => context.getFragment(name) });
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query is too deep: ${depth} levels, maximum is ${maxDepth}.`, {
              nodes: [node],
              extensions: { code: "QUERY_TOO_DEEP", depth, maxDepth },
            }),
          );
        }
      },
    };
  };
}

/** Cost rule factory. Same shape, same reporting discipline. */
function createCostRule(maxCost = DEFAULT_MAX_COST) {
  return function CostLimitRule(context) {
    return {
      OperationDefinition(node) {
        const { cost } = measure({ definitions: [node] }, { getFragment: (name) => context.getFragment(name) });
        if (cost > maxCost) {
          context.reportError(
            new GraphQLError(`Query is too costly: ${cost} points, maximum is ${maxCost}.`, {
              nodes: [node],
              extensions: { code: "QUERY_TOO_COSTLY", cost, maxCost },
            }),
          );
        }
      },
    };
  };
}

/** The pair, ready to append to `specifiedRules`. */
function createLimitRules({ maxDepth = DEFAULT_MAX_DEPTH, maxCost = DEFAULT_MAX_COST } = {}) {
  return [createDepthRule(maxDepth), createCostRule(maxCost)];
}

module.exports = {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_COST,
  DEFAULT_LIST_FACTOR,
  measure,
  pageSizeOf,
  createDepthRule,
  createCostRule,
  createLimitRules,
};
