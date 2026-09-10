import { describe, it, expect } from "vitest";

// Pillar assembly and the extensibility contract (PRD §11, §14.4 item 6).
//
// The fake-pillar test is the point of this file. Goal G5 promises that a new
// pillar is one directory plus one registry entry, with NO edit to the executor,
// the router, the controller, `CrewMember`'s base fields, or any existing pillar.
// A promise like that rots silently, so it is verified here: a pillar invented
// inside the test must appear in the SDL, resolve real data, and extend
// `CrewMember` — without a single line changing anywhere else.
const { printSchema } = require("graphql");
const { assembleCrewSchema, resolvePillars, mergeResolvers, CORE_TYPE_DEFS } = require("../../services/crew/registry");
const { runOperation } = require("../../services/graphql");
const profilesPillar = require("../../services/crew/pillars/profiles");

/** A pillar that does not exist in the codebase, satisfying the §11 contract. */
function makeFakePillar(overrides = {}) {
  return {
    name: "weather",
    foundation: false,
    dependsOn: ["profiles"],
    typeDefs: `
      type WeatherSummary {
        outlook: String!
        rainedOff: Boolean!
      }
      extend type CrewMember {
        weather: WeatherSummary
      }
      extend type Query {
        crewWeatherOutlook: String!
      }
      extend type Mutation {
        declareRainedOff(staffId: ID!): Boolean!
      }
    `,
    resolvers: {
      Query: { crewWeatherOutlook: () => "drizzle" },
      Mutation: { declareRainedOff: () => true },
      CrewMember: { weather: () => ({ outlook: "drizzle", rainedOff: true }) },
      WeatherSummary: { outlook: (summary) => summary.outlook, rainedOff: (summary) => summary.rainedOff },
    },
    createService: () => ({ kind: "fake-weather-service" }),
    stores: [],
    ...overrides,
  };
}

/** A context stub — enough for the fake pillar's resolvers, no HTTP, no stores. */
function makeContextStub(pillars) {
  const context = {
    userId: 1,
    clock: { nowIso: () => "2026-07-29T10:00:00.000Z", today: () => "2026-07-29" },
    pillars: pillars.map((pillar) => pillar.name),
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead: () => {},
    loaders: {
      ownedStaff: { get: async () => [{ id: 1, userId: 1, name: "Mike", surname: "Mayer", age: 88 }] },
      staffById: { get: async (id) => (Number(id) === 1 ? { id: 1, userId: 1, name: "Mike", surname: "Mayer", age: 88 } : undefined) },
      fieldIdsByStaffId: { all: async () => new Map([[1, [7]]]) },
    },
    addLoader: (name, load) => ({ all: load, get: async (key) => (await load()).get(key) }),
  };
  for (const pillar of pillars) {
    if (typeof pillar.createService === "function") context.services[pillar.name] = pillar.createService(context);
  }
  return context;
}

describe("crew registry — core assembly", () => {
  it("assembles the built-in pillars with no dropped dependencies", () => {
    const { pillars, dropped } = assembleCrewSchema();
    expect(pillars.map((pillar) => pillar.name)).toContain("profiles");
    expect(dropped).toEqual([]);
  });

  it("gives the root Query type a real field of its own, so no pillar has to declare it", () => {
    // Without `crewInfo`, the core could not declare `type Query` and pillars
    // would race to be the one that does.
    expect(CORE_TYPE_DEFS).toMatch(/type Query \{[\s\S]*crewInfo: CrewInfo!/);
  });

  it("puts the foundation pillar first, so `type Mutation` is declared before it is extended", () => {
    const fake = makeFakePillar();
    const { pillars } = resolvePillars([fake, profilesPillar]);
    expect(pillars[0].name).toBe("profiles");
  });

  it("refuses a resolver collision instead of letting one pillar silently win", () => {
    const a = { Query: { crewInfo: () => 1 } };
    const b = { Query: { crewInfo: () => 2 } };
    expect(() => mergeResolvers([a, b])).toThrow(/resolver collision on Query\.crewInfo/);
  });

  it("drops a pillar whose hard dependency is missing rather than half-assembling it", () => {
    const orphanPillar = makeFakePillar({ name: "payroll", dependsOn: ["accounting"] });
    const { pillars, dropped } = resolvePillars([profilesPillar, orphanPillar]);
    expect(pillars.map((pillar) => pillar.name)).toEqual(["profiles"]);
    expect(dropped).toEqual([{ name: "payroll", missing: ["accounting"] }]);
  });

  it("fails assembly loudly when a resolver names a field the SDL does not have", () => {
    // The bug this catches: a pillar renames a field in its SDL and forgets the
    // resolver. Without this check the field would silently resolve to null.
    const typo = makeFakePillar({
      resolvers: { Query: { crewWeatherOutlookk: () => "x" } },
    });
    expect(() => assembleCrewSchema({ pillars: [profilesPillar, typo] })).toThrow(/unknown field "Query.crewWeatherOutlookk"/);
  });

  it("fails assembly when a union has no __resolveType", () => {
    const unionPillar = makeFakePillar({
      typeDefs: `
        type Sun { warm: Boolean! }
        type Rain { wet: Boolean! }
        union Forecast = Sun | Rain
        extend type Query { forecast: Forecast! }
      `,
      resolvers: { Query: { forecast: () => ({ warm: true }) } },
    });
    expect(() => assembleCrewSchema({ pillars: [profilesPillar, unionPillar] })).toThrow(/needs __resolveType/);
  });

  it("fails assembly when the SDL declares a scalar nobody implements", () => {
    const scalarPillar = makeFakePillar({
      typeDefs: `scalar Hectares\nextend type Query { area: Hectares! }`,
      resolvers: { Query: { area: () => 1 } },
    });
    expect(() => assembleCrewSchema({ pillars: [profilesPillar, scalarPillar] })).toThrow(/scalar "Hectares" is declared/);
  });
});

describe("crew registry — the fake-pillar extensibility test (G5)", () => {
  it("a pillar invented in this test appears in the SDL with no core change", () => {
    const { schema, pillars } = assembleCrewSchema({ pillars: [profilesPillar, makeFakePillar()] });
    const sdl = printSchema(schema);

    expect(pillars.map((pillar) => pillar.name)).toEqual(["profiles", "weather"]);
    expect(sdl).toMatch(/type WeatherSummary/);
    expect(sdl).toMatch(/crewWeatherOutlook: String!/);
    expect(sdl).toMatch(/declareRainedOff/);
    // The join point: the new pillar hung one field on CrewMember.
    expect(schema.getType("CrewMember").getFields().weather).toBeDefined();
  });

  it("its query resolves, and its CrewMember field resolves alongside the real pillar's", async () => {
    const pillars = [profilesPillar, makeFakePillar()];
    const { schema } = assembleCrewSchema({ pillars });
    const context = makeContextStub(pillars);

    const { status, body } = await runOperation({
      schema,
      source: "{ crewWeatherOutlook crewInfo { pillars crewSize } }",
      contextValue: context,
    });

    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();
    expect(body.data.crewWeatherOutlook).toBe("drizzle");
    expect(body.data.crewInfo.pillars).toEqual(["profiles", "weather"]);
  });

  it("disappears completely when it is not registered — no residue in the schema", () => {
    const { schema } = assembleCrewSchema({ pillars: [profilesPillar] });
    const sdl = printSchema(schema);

    expect(sdl).not.toMatch(/WeatherSummary/);
    expect(sdl).not.toMatch(/crewWeatherOutlook/);
    expect(schema.getType("CrewMember").getFields().weather).toBeUndefined();

    // And selecting the absent field is an honest validation error naming an
    // unknown field, not a null and not a crash (§5.2 rule 3).
    return runOperation({ schema, source: "{ crewWeatherOutlook }" }).then(({ status, body }) => {
      expect(status).toBe(400);
      expect(body.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
      expect(body.errors[0].message).toMatch(/Cannot query field "crewWeatherOutlook"/);
    });
  });

  it("its service reaches the context the same way a real pillar's does", () => {
    const pillars = [profilesPillar, makeFakePillar()];
    const context = makeContextStub(pillars);
    expect(context.services.weather).toEqual({ kind: "fake-weather-service" });
    expect(context.services.profiles).toBeDefined();
  });
});

describe("crew registry — the module contains no delete mutation", () => {
  it("no mutation name suggests firing, deleting or reassigning", () => {
    // §12.2 as a schema-level assertion. A future "tidy up" that adds
    // `deleteCrewMember` fails here before it reaches review.
    const { schema } = assembleCrewSchema();
    const mutationNames = Object.keys(schema.getMutationType().getFields());

    for (const name of mutationNames) {
      expect(name).not.toMatch(/delete|remove|fire|terminate|dismiss|assignToField|assignStaff/i);
    }
    expect(mutationNames).toContain("recordEmploymentEnd"); // the sanctioned way
  });
});
