import { describe, it, expect } from "vitest";

// Schema assembly and the one-slot cache (PRD §14.1).
//
// Deliberately NOT tested here: parsing, the ~20 spec validation rules,
// introspection, abstract-type resolution and non-null error bubbling. `graphql-js`
// owns those and covers them in its own suite — that saving is the concrete
// pay-off of the §7.2 decision to import the reference executor rather than
// hand-roll one. What IS tested is everything we built on top of it.
const { printSchema } = require("graphql");
const { assembleSchema, createSchemaCache, attachResolvers } = require("../../services/graphql/schema");
const { SCALAR_TYPE_DEFS } = require("../../services/graphql/scalars");

const BASE = `
  ${SCALAR_TYPE_DEFS}
  type Query { hello: String when: Date }
`;

describe("assembleSchema", () => {
  it("joins SDL fragments from modules that never see each other", () => {
    const { schema, sdl } = assembleSchema({
      typeDefs: [BASE, `type Extra { note: String }`, `extend type Query { extra: Extra }`],
      resolvers: {},
    });
    expect(sdl).toMatch(/type Extra/);
    expect(Object.keys(schema.getQueryType().getFields())).toEqual(["hello", "when", "extra"]);
  });

  it("refuses to assemble nothing", () => {
    expect(() => assembleSchema({ typeDefs: [] })).toThrow(/no type definitions/);
    expect(() => assembleSchema({ typeDefs: "   " })).toThrow(/no type definitions/);
  });

  it("grafts real coercion onto the SDL's placeholder scalars", () => {
    // `buildSchema` reads `scalar Date` as an opaque pass-through. Without this
    // step every custom scalar would silently accept anything.
    const { schema } = assembleSchema({ typeDefs: BASE, resolvers: {} });
    const dateType = schema.getType("Date");
    expect(() => dateType.parseValue("2026-02-30")).toThrow(/not a real calendar date/);
    expect(dateType.parseValue("2026-07-29")).toBe("2026-07-29");
    expect(dateType.description).toMatch(/YYYY-MM-DD/);
  });

  it("leaves the built-in scalars alone", () => {
    const { schema } = assembleSchema({ typeDefs: BASE, resolvers: {} });
    expect(schema.getType("String").parseValue("anything")).toBe("anything");
  });

  it("rejects a resolver for an unknown type or field", () => {
    expect(() => assembleSchema({ typeDefs: BASE, resolvers: { Nope: { x: () => 1 } } })).toThrow(/unknown type "Nope"/);
    expect(() => assembleSchema({ typeDefs: BASE, resolvers: { Query: { nope: () => 1 } } })).toThrow(/unknown field "Query.nope"/);
  });

  it("rejects a non-function resolver", () => {
    expect(() => assembleSchema({ typeDefs: BASE, resolvers: { Query: { hello: "not a function" } } })).toThrow(/is not a function/);
  });

  it("rejects field resolvers attached to an input type", () => {
    const typeDefs = [BASE, `input Thing { a: String }`];
    expect(() => assembleSchema({ typeDefs, resolvers: { Thing: { a: () => 1 } } })).toThrow(/cannot attach field resolvers/);
  });
});

describe("attachResolvers", () => {
  it("actually installs the resolver, so the field is not left resolving to null", () => {
    const { schema } = assembleSchema({ typeDefs: BASE, resolvers: { Query: { hello: () => "hi" } } });
    expect(schema.getQueryType().getFields().hello.resolve()).toBe("hi");
  });

  it("installs __resolveType on a union", () => {
    const { schema } = assembleSchema({
      typeDefs: [BASE, `type A { a: String } type B { b: String } union AB = A | B`, `extend type Query { ab: AB }`],
      resolvers: { AB: { __resolveType: (value) => value.__typename } },
    });
    expect(schema.getType("AB").resolveType({ __typename: "A" })).toBe("A");
  });

  it("is idempotent enough to re-attach onto an existing schema", () => {
    const { schema } = assembleSchema({ typeDefs: BASE, resolvers: {} });
    attachResolvers(schema, { Query: { hello: () => "first" } });
    attachResolvers(schema, { Query: { hello: () => "second" } });
    expect(schema.getQueryType().getFields().hello.resolve()).toBe("second");
  });
});

describe("the schema cache", () => {
  it("builds once and reuses", () => {
    let builds = 0;
    const cache = createSchemaCache(() => {
      builds += 1;
      return { schema: "s", sdl: "sdl" };
    });

    expect(cache.isWarm).toBe(false);
    cache.get();
    cache.get();
    cache.get();
    expect(builds).toBe(1);
    expect(cache.isWarm).toBe(true);
  });

  it("rebuilds after invalidate", () => {
    // With one module flag there are only two states — absent, or this schema —
    // so invalidation exists for tests and for a hot-swapped pillar, not for
    // flag flips. It still has to work.
    let builds = 0;
    const cache = createSchemaCache(() => ({ build: ++builds }));
    expect(cache.get().build).toBe(1);
    cache.invalidate();
    expect(cache.isWarm).toBe(false);
    expect(cache.get().build).toBe(2);
  });

  it("does not build until first use, so an unused schema costs nothing", () => {
    let built = false;
    createSchemaCache(() => {
      built = true;
      return {};
    });
    expect(built).toBe(false);
  });
});

describe("the assembled crew schema", () => {
  it("prints a stable SDL with the join point and the pillar field on it", () => {
    const { assembleCrewSchema } = require("../../services/crew/registry");
    const sdl = printSchema(assembleCrewSchema().schema);

    expect(sdl).toMatch(/type CrewMember/);
    expect(sdl).toMatch(/orphaned: Boolean!/);
    expect(sdl).toMatch(/profile: CrewProfile/);
    // Read-only assignment view: exposed for display, with no mutation to change it.
    expect(sdl).toMatch(/assignedFieldIds: \[ID!\]!/);
  });
});
