import { describe, it, expect } from "vitest";

// Depth and cost guards (PRD §14.1).
//
// Two symmetric obligations, and the second one is the easy one to forget: the
// rules must reject what they claim to reject AND never fire on a legal query.
// A depth guard with an off-by-one that rejects the roster query is worse than no
// guard at all, so every "rejects" case is paired with an at-the-boundary "accepts".
const { parse } = require("graphql");
const { measure, createDepthRule, createCostRule, createLimitRules } = require("../../services/graphql/limits");
const { assembleSchema } = require("../../services/graphql/schema");
const { SCALAR_TYPE_DEFS } = require("../../services/graphql/scalars");
const { validate, specifiedRules } = require("graphql");

// A fixture schema with NO crew knowledge — this layer is domain-free and the
// test proves it by exercising it against a toy graph.
const { schema } = assembleSchema({
  typeDefs: `
    ${SCALAR_TYPE_DEFS}
    type Node { id: ID! label: String child: Node children(first: Int): [Node!]! }
    type Query { root: Node! nodes(first: Int): [Node!]! }
  `,
  resolvers: {},
});

function depthOf(source) {
  return measure(parse(source)).depth;
}
function costOf(source) {
  return measure(parse(source)).cost;
}
function runRules(source, rules) {
  return validate(schema, parse(source), [...specifiedRules, ...rules]);
}

describe("query depth measurement", () => {
  it("counts a root field plus its leaf selection as depth 2", () => {
    expect(depthOf("{ root { id } }")).toBe(2);
    expect(depthOf("{ nodes { id } }")).toBe(2);
  });

  it("counts each nesting level", () => {
    expect(depthOf("{ root { child { child { id } } } }")).toBe(4);
  });

  it("follows fragment spreads — depth cannot be hidden in a fragment", () => {
    // This is the bypass a naive walker misses: the fragment adds two levels the
    // operation body does not show.
    const source = `
      { root { ...deep } }
      fragment deep on Node { child { child { id } } }
    `;
    expect(depthOf(source)).toBe(4);
  });

  it("does not count an inline fragment as a level of its own", () => {
    // An inline fragment is a type condition, not a step down the graph.
    expect(depthOf("{ root { ... on Node { id } } }")).toBe(2);
  });

  it("survives a cyclic fragment instead of spinning", () => {
    // NoFragmentCyclesRule will reject this query anyway — but measurement runs
    // over the same document, so it must terminate rather than recurse forever.
    const source = `
      { root { ...a } }
      fragment a on Node { child { ...b } }
      fragment b on Node { child { ...a } }
    `;
    expect(() => depthOf(source)).not.toThrow();
  });
});

describe("query cost measurement", () => {
  it("charges one point per field", () => {
    expect(costOf("{ root { id label } }")).toBe(3); // root + id + label
  });

  it("multiplies children by a literal page size", () => {
    // 1 for `nodes`, then 3 pages × 2 fields.
    expect(costOf("{ nodes(first: 3) { id label } }")).toBe(1 + 3 * 2);
  });

  it("charges a variable page size the default factor rather than trusting it", () => {
    // Variables are not bound at validation time, so the safe direction is to
    // assume a full page. Under-charging here would be the exploitable choice.
    const withVariable = costOf("query Q($n: Int) { nodes(first: $n) { id } }");
    const withLiteralTen = costOf("{ nodes(first: 10) { id } }");
    expect(withVariable).toBe(withLiteralTen);
  });

  it("does not charge for introspection meta-fields", () => {
    // The explorer's schema tab must not be expensive.
    expect(costOf("{ __typename }")).toBe(0);
    expect(costOf("{ root { __typename id } }")).toBe(2); // root + id only
  });

  it("compounds nested page sizes", () => {
    const cost = costOf("{ nodes(first: 5) { children(first: 4) { id } } }");
    // nodes(1) + 5×children(5) + 5×4×id(20)
    expect(cost).toBe(1 + 5 + 20);
  });
});

describe("depth rule", () => {
  it("rejects at the boundary with QUERY_TOO_DEEP", () => {
    const errors = runRules("{ root { child { child { id } } } }", [createDepthRule(3)]);
    expect(errors).toHaveLength(1);
    expect(errors[0].extensions.code).toBe("QUERY_TOO_DEEP");
    expect(errors[0].extensions).toMatchObject({ depth: 4, maxDepth: 3 });
  });

  it("accepts a query exactly AT the limit — no off-by-one", () => {
    expect(runRules("{ root { child { child { id } } } }", [createDepthRule(4)])).toEqual([]);
  });

  it("reports a location, so the client can point at the query", () => {
    const errors = runRules("{ root { child { child { id } } } }", [createDepthRule(2)]);
    expect(errors[0].locations?.length).toBeGreaterThan(0);
  });
});

describe("cost rule", () => {
  it("rejects an over-budget query with QUERY_TOO_COSTLY", () => {
    const errors = runRules("{ nodes(first: 100) { id label child { id } } }", [createCostRule(50)]);
    expect(errors).toHaveLength(1);
    expect(errors[0].extensions.code).toBe("QUERY_TOO_COSTLY");
  });

  it("accepts a small query", () => {
    expect(runRules("{ root { id } }", [createCostRule(50)])).toEqual([]);
  });
});

describe("the rules together", () => {
  it("never fires on an ordinary query", () => {
    // The regression that matters: default limits must leave real usage alone.
    const ordinary = "{ nodes(first: 25) { id label child { id label } } }";
    expect(runRules(ordinary, createLimitRules())).toEqual([]);
  });

  it("still runs every spec rule alongside — ours are appended, not a replacement", () => {
    const errors = runRules("{ root { nope } }", createLimitRules());
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Cannot query field "nope"/);
  });
});
