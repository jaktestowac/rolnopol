/**
 * Schema assembly (PRD §7.2, §11).
 *
 * SDL text in, executable schema out. Three things happen here and nowhere else:
 *
 *   1. SDL fragments from independent modules are concatenated and handed to
 *      `buildSchema()`. Modules never see each other; they only agree on the
 *      convention that the first one DECLARES a root type and the rest `extend`
 *      it. A malformed fragment fails loudly at assembly, not at query time.
 *   2. Custom scalars replace the placeholders `buildSchema()` leaves behind.
 *      `buildSchema` reads `scalar Date` as "some opaque scalar" with pass-through
 *      coercion; the real behaviour from scalars.js is grafted on afterwards.
 *   3. Resolvers are attached to the built schema — field resolvers, plus
 *      `__resolveType` for unions and interfaces. Without step 3 the schema would
 *      only resolve through `rootValue`, which cannot express `CrewMember.profile`
 *      or a result union at all.
 *
 * This file knows nothing about crews. It is the reusable half of the module.
 */
const { buildSchema, GraphQLScalarType, GraphQLObjectType, GraphQLUnionType, GraphQLInterfaceType } = require("graphql");
const { SCALARS } = require("./scalars");

/**
 * @param {object} options
 * @param {string[]|string} options.typeDefs - SDL fragments, joined in order
 * @param {object} [options.resolvers] - { TypeName: { fieldName: fn, __resolveType: fn } }
 * @param {object} [options.scalars] - name → GraphQLScalarType (defaults to ours)
 * @returns {import("graphql").GraphQLSchema}
 */
function assembleSchema({ typeDefs, resolvers = {}, scalars = SCALARS }) {
  const sdl = (Array.isArray(typeDefs) ? typeDefs : [typeDefs]).filter(Boolean).join("\n\n");
  if (!sdl.trim()) {
    throw new Error("assembleSchema: no type definitions supplied");
  }

  const schema = buildSchema(sdl);
  applyScalars(schema, scalars);
  attachResolvers(schema, resolvers);
  assertAbstractTypesResolvable(schema);
  return { schema, sdl };
}

/**
 * Every union and interface must know how to name its concrete type.
 *
 * Without this check the gap is invisible until a query happens to select that
 * union, and then it surfaces as a runtime "abstract type must resolve to an
 * Object type" — at the worst possible moment, from the worst possible distance.
 * A result union with no `__resolveType` is a broken pillar, so assembly refuses
 * it: the module either serves a coherent schema or fails to start.
 */
function assertAbstractTypesResolvable(schema) {
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    const isAbstract = type instanceof GraphQLUnionType || type instanceof GraphQLInterfaceType;
    if (!isAbstract) continue;
    if (typeof type.resolveType !== "function") {
      throw new Error(
        `assembleSchema: ${type instanceof GraphQLUnionType ? "union" : "interface"} "${type.name}" needs __resolveType — no resolver supplied one`,
      );
    }
  }
}

/**
 * Graft real coercion onto the placeholder scalars from the SDL.
 *
 * A declared-but-unimplemented scalar is a silent hole — it would accept
 * anything and hand it to a resolver — so an SDL scalar with no implementation
 * is an error rather than a default.
 */
function applyScalars(schema, scalars) {
  for (const type of Object.values(schema.getTypeMap())) {
    if (!(type instanceof GraphQLScalarType)) continue;
    if (type.name.startsWith("__")) continue;
    const implementation = scalars[type.name];
    if (!implementation) {
      // Built-in scalars (String, Int, Float, Boolean, ID) arrive fully formed.
      if (["String", "Int", "Float", "Boolean", "ID"].includes(type.name)) continue;
      throw new Error(`assembleSchema: scalar "${type.name}" is declared in the SDL but has no implementation`);
    }
    type.serialize = implementation.serialize.bind(implementation);
    type.parseValue = implementation.parseValue.bind(implementation);
    type.parseLiteral = implementation.parseLiteral.bind(implementation);
    if (implementation.description) type.description = implementation.description;
  }
}

/**
 * Attach resolvers, failing on anything that does not correspond to the schema.
 *
 * The strictness is the point: a resolver attached to a field that was renamed
 * in the SDL would otherwise sit there resolving nothing, and the field would
 * silently return null. That is exactly the class of bug a typo'd pillar
 * introduces, so it is an assembly-time error instead.
 */
function attachResolvers(schema, resolvers) {
  for (const [typeName, fieldResolvers] of Object.entries(resolvers)) {
    const type = schema.getType(typeName);
    if (!type) {
      throw new Error(`assembleSchema: resolvers reference unknown type "${typeName}"`);
    }

    if (type instanceof GraphQLUnionType || type instanceof GraphQLInterfaceType) {
      if (typeof fieldResolvers.__resolveType !== "function") {
        throw new Error(
          `assembleSchema: ${typeName} is a ${type instanceof GraphQLUnionType ? "union" : "interface"} and needs __resolveType`,
        );
      }
      type.resolveType = fieldResolvers.__resolveType;
      continue;
    }

    if (!(type instanceof GraphQLObjectType)) {
      throw new Error(`assembleSchema: cannot attach field resolvers to "${typeName}" (${type.constructor.name})`);
    }

    const fields = type.getFields();
    for (const [fieldName, resolver] of Object.entries(fieldResolvers)) {
      if (fieldName === "__resolveType") continue;
      if (!fields[fieldName]) {
        throw new Error(`assembleSchema: resolver for unknown field "${typeName}.${fieldName}"`);
      }
      if (typeof resolver !== "function") {
        throw new Error(`assembleSchema: resolver for "${typeName}.${fieldName}" is not a function`);
      }
      fields[fieldName].resolve = resolver;
    }
  }
}

/**
 * A one-slot cache.
 *
 * Crew Office has a single feature flag, so the module has exactly two states:
 * absent, or this one schema. That is why there is no cache key here — an
 * earlier draft keyed the cache by a tuple of five flags, and collapsing that
 * to one flag collapsed the cache with it. `invalidate()` exists for tests and
 * for a future pillar being hot-swapped, not for flag flips.
 */
function createSchemaCache(build) {
  let cached = null;
  return {
    get() {
      if (!cached) cached = build();
      return cached;
    },
    invalidate() {
      cached = null;
    },
    get isWarm() {
      return cached !== null;
    },
  };
}

module.exports = { assembleSchema, createSchemaCache, applyScalars, attachResolvers, assertAbstractTypesResolvable };
