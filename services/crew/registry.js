/**
 * Pillar assembly — the extension seam (PRD §11).
 *
 * Goal G5 says a new pillar must be one directory, one registry entry and its own
 * tests, with no edit to the executor, the router, the controller or any existing
 * pillar. This file is the mechanism that makes that true, and
 * `crew.registry.test.js` proves it by registering a FAKE pillar and asserting it
 * appears in the SDL, resolves, and disappears again.
 *
 * A pillar is an object:
 *
 *   {
 *     name: "leave",                    // unique; appears in extensions.pillars
 *     dependsOn: ["profiles"],          // pillar names; a missing hard dep drops it
 *     foundation: false,                // true ⇒ declares the root types (see below)
 *     typeDefs: "…SDL…",                // may extend CrewMember with exactly one field
 *     resolvers: { Query: {…}, … },
 *     createService: (context) => ({…}), // per-request service, scoping lives here
 *     stores: [{ resource, file, defaultData }],
 *     seed: async (store) => {},
 *     health: async () => ({ status, detail }),
 *   }
 *
 * Two conventions the SDL fragments must follow, because SDL has no notion of
 * "whoever gets here first":
 *
 *   1. **The core declares `type Query`**, so every pillar writes
 *      `extend type Query { … }`.
 *   2. **The foundation pillar declares `type Mutation`**; every other pillar
 *      writes `extend type Mutation { … }`. Profiles is the foundation and is
 *      never absent (§5.2 rule 4), so there is always something to extend.
 *      Assembly sorts foundation-first specifically to guarantee this.
 *
 * Note what is NOT here any more: flag filtering. With one module-level flag
 * (§5.1.1) a pillar is either compiled in or not — there is no per-pillar switch,
 * so `enabledPillars` collapsed to "the pillars that loaded". Load failure is
 * still handled: a pillar that throws on require is skipped, logged, and the
 * module serves the rest (§12 rule 6).
 */
const { logError, logInfo } = require("../../helpers/logger-api");
const { assembleSchema, createSchemaCache } = require("../graphql/schema");
const { SCALAR_TYPE_DEFS } = require("../graphql/scalars");

/**
 * Core SDL: the types that belong to the module rather than to any pillar.
 *
 * `CrewMember` is the join point — base identity read from `staff.json`, plus one
 * field per pillar grafted on by that pillar's own SDL. `crewInfo` gives the root
 * `Query` type a real field of its own, which the explorer and the health page
 * both use; without it the core could not declare `Query` at all, and pillars
 * would have to fight over who declares it first.
 */
const CORE_TYPE_DEFS = `
${SCALAR_TYPE_DEFS}

"""
One person on the crew. Identity comes from the staff record (read-only here);
each pillar contributes exactly one field of its own.
"""
type CrewMember {
  staffId: ID!
  "Null when the staff record is gone but crew overlay rows remain."
  name: String
  surname: String
  age: Int
  "True when this member's staff record has been deleted from under the overlay."
  orphaned: Boolean!
  "Fields this member is assigned to. READ-ONLY — Crew Office never changes an assignment."
  assignedFieldIds: [ID!]!
}

"What this Crew Office is made of. Useful for the explorer and for tests."
type CrewInfo {
  pillars: [String!]!
  "Number of staff records owned by the caller, profile or not."
  crewSize: Int!
  "Server time, from the request clock — never the client's."
  serverTime: DateTime!
}

"A crew overlay row whose staff record no longer exists (§12 rule 4)."
type OrphanedOverlay {
  pillar: String!
  staffId: ID!
  rowId: ID!
  detail: String
}

type Query {
  crewInfo: CrewInfo!
  "Maintenance: overlay rows left behind by DELETE /api/v1/staff/:id."
  orphanedOverlays: [OrphanedOverlay!]!
}
`;

/** Resolvers for the core types. Pillars supply their own. */
const CORE_RESOLVERS = {
  Query: {
    crewInfo: async (_source, _args, context) => {
      const owned = await context.loaders.ownedStaff.get();
      return {
        pillars: context.pillars,
        crewSize: owned.length,
        serverTime: context.clock.nowIso(),
      };
    },
    orphanedOverlays: async (_source, _args, context) => {
      // Every pillar that can own overlay rows reports its own orphans. A pillar
      // that does not implement the hook simply contributes nothing.
      const results = [];
      for (const [name, service] of Object.entries(context.services)) {
        if (typeof service?.findOrphanedOverlays !== "function") continue;
        const rows = await service.findOrphanedOverlays();
        for (const row of rows) results.push({ pillar: name, ...row });
      }
      return results;
    },
  },
  CrewMember: {
    // The staff record may be absent (orphan) — every field here is null-safe,
    // because a deleted staff member must degrade rather than crash (§12 rule 4).
    staffId: (member) => String(member.staffId),
    name: (member) => member.staff?.name ?? null,
    surname: (member) => member.staff?.surname ?? null,
    age: (member) => (member.staff?.age === undefined ? null : member.staff.age),
    orphaned: (member) => member.staff == null,
    assignedFieldIds: async (member, _args, context) => {
      const byStaffId = await context.loaders.fieldIdsByStaffId.all();
      return (byStaffId.get(Number(member.staffId)) || []).map(String);
    },
  },
};

/**
 * Load the built-in pillars, defensively.
 *
 * A pillar whose require throws is skipped rather than fatal: the module must
 * degrade to the pillars that did load, and the app must boot either way
 * (§12 rule 6). This is also what lets Phases 3–6 land one directory at a time.
 */
function loadBuiltInPillars() {
  const specs = [
    { name: "profiles", path: "./pillars/profiles" },
    { name: "work", path: "./pillars/work" },
    { name: "leave", path: "./pillars/leave" },
    { name: "training", path: "./pillars/training" },
    { name: "tools", path: "./pillars/tools" },
    { name: "documents", path: "./pillars/documents" },
  ];

  const pillars = [];
  for (const spec of specs) {
    try {
      // eslint-disable-next-line global-require
      const pillar = require(spec.path);
      pillars.push(pillar);
    } catch (error) {
      logError(`[crew] pillar "${spec.name}" failed to load — continuing without it`, {
        error: error instanceof Error ? error.stack || error.message : error,
      });
    }
  }
  return pillars;
}

/**
 * Resolve dependencies and order the pillars.
 *
 * A pillar whose hard dependency is missing is dropped, not half-assembled —
 * a `CrewMember.leave` field whose profiles join does not exist would resolve to
 * nonsense. Foundation first, so `type Mutation` is declared before it is
 * extended.
 */
function resolvePillars(candidates) {
  const byName = new Map(candidates.map((pillar) => [pillar.name, pillar]));
  const kept = [];
  const dropped = [];

  for (const pillar of candidates) {
    const missing = (pillar.dependsOn || []).filter((dependency) => !byName.has(dependency));
    if (missing.length > 0) {
      dropped.push({ name: pillar.name, missing });
      continue;
    }
    kept.push(pillar);
  }

  kept.sort((a, b) => {
    if (a.foundation === b.foundation) return a.name.localeCompare(b.name);
    return a.foundation ? -1 : 1;
  });

  return { pillars: kept, dropped };
}

/** Deep-merge resolver maps one level down, refusing silent collisions. */
function mergeResolvers(maps) {
  const merged = {};
  for (const map of maps) {
    for (const [typeName, fields] of Object.entries(map || {})) {
      merged[typeName] = merged[typeName] || {};
      for (const [fieldName, resolver] of Object.entries(fields)) {
        if (merged[typeName][fieldName]) {
          // Two pillars claiming the same field is a real conflict: one of them
          // would silently win. Better to fail assembly and make it visible.
          throw new Error(`[crew] resolver collision on ${typeName}.${fieldName}`);
        }
        merged[typeName][fieldName] = resolver;
      }
    }
  }
  return merged;
}

/**
 * Assemble the schema from a pillar set.
 *
 * @param {object} [options]
 * @param {Array} [options.pillars] - override for tests (the fake-pillar test)
 * @returns {{ schema, sdl, pillars, dropped }}
 */
function assembleCrewSchema({ pillars: override } = {}) {
  const candidates = override || loadBuiltInPillars();
  const { pillars, dropped } = resolvePillars(candidates);

  const typeDefs = [CORE_TYPE_DEFS, ...pillars.map((pillar) => pillar.typeDefs)];
  const resolvers = mergeResolvers([CORE_RESOLVERS, ...pillars.map((pillar) => pillar.resolvers)]);

  const { schema, sdl } = assembleSchema({ typeDefs, resolvers });

  if (dropped.length > 0) {
    logInfo("[crew] pillars dropped for missing dependencies", { dropped });
  }

  return { schema, sdl, pillars, dropped };
}

/**
 * The module-wide cache. One flag means one schema, so this is a one-slot cache
 * built on first request and reused (§5.2 rule 6).
 */
const schemaCache = createSchemaCache(() => assembleCrewSchema());

/** Everything the controller needs, assembled once. */
function getCrewSchema() {
  return schemaCache.get();
}

/**
 * First-enable demo seeding (PRD §11, §6.6).
 *
 * Crew stores are excluded from `database-base-state.json` and from the debug
 * restore, so the repo's usual seeding path never touches them — which leaves the
 * roster empty on first enable. That is defensible (a staff member with no profile
 * is a supported state, §17 Q1) but unhelpful: the point of the module is to be
 * looked at.
 *
 * So each pillar's `seed` runs at most once per process, and only when its store
 * file does not exist yet — i.e. genuinely at first enable, never again. Two
 * consequences to be clear about:
 *
 *   - it writes ONLY to crew-owned stores. Seeding profiles the staff records that
 *     are already there; it never creates, edits or deletes one (§12.2);
 *   - it cannot run while the flag is off, because nothing here is reachable
 *     without passing the gate — so "flag off ⇒ no crew store file" still holds.
 */
const seededThisProcess = new Set();

async function runFirstEnableSeeds(context) {
  const { pillars } = getCrewSchema();
  const dataDir = require("path").join(__dirname, "..", "..", "data");
  const fs = require("fs");

  for (const pillar of pillars) {
    if (typeof pillar.seed !== "function") continue;
    if (seededThisProcess.has(pillar.name)) continue;

    const files = (pillar.stores || []).map((store) => require("path").join(dataDir, store.file));
    const alreadyOnDisk = files.length > 0 && files.every((file) => fs.existsSync(file));
    // Mark before running: a seed that throws must not be retried on every
    // request for the rest of the process's life.
    seededThisProcess.add(pillar.name);
    if (alreadyOnDisk) continue;

    try {
      const staffRecords = await context.loaders.ownedStaff.get();
      await pillar.seed({
        staffRecords,
        today: context.clock.today(),
        nowIso: context.clock.nowIso(),
      });
      logInfo(`[crew] seeded demo data for pillar "${pillar.name}"`, { staffRecords: staffRecords.length });
    } catch (error) {
      // A failed seed is cosmetic: the module works with an empty overlay.
      logError(`[crew] demo seed for pillar "${pillar.name}" failed — continuing`, {
        error: error instanceof Error ? error.stack || error.message : error,
      });
    }
  }
}

/** Test hook: forget which pillars were seeded this process. */
function resetSeedState() {
  seededThisProcess.clear();
}

/** Health per pillar, for `/crew/health`. */
async function pillarHealth() {
  const { pillars } = getCrewSchema();
  const rows = [];
  for (const pillar of pillars) {
    let health = { status: "ok", detail: null };
    if (typeof pillar.health === "function") {
      try {
        health = await pillar.health();
      } catch (error) {
        health = { status: "error", detail: error.message };
      }
    }
    rows.push({ name: pillar.name, ...health });
  }
  return rows;
}

module.exports = {
  CORE_TYPE_DEFS,
  CORE_RESOLVERS,
  assembleCrewSchema,
  getCrewSchema,
  pillarHealth,
  runFirstEnableSeeds,
  resetSeedState,
  resolvePillars,
  mergeResolvers,
  loadBuiltInPillars,
  schemaCache,
};
