/**
 * Profiles pillar manifest (PRD §11).
 *
 * This is the whole contract a pillar satisfies. A fifth pillar is a directory
 * shaped like this one plus one line in `registry.js` — no change to the executor,
 * the router, the controller, `CrewMember`'s base fields, or any existing pillar.
 * `crew.registry.test.js` proves that by registering a fake pillar against this
 * same interface.
 *
 * Profiles is the FOUNDATION: it has no dependencies, it declares `type Mutation`
 * for the others to extend, and it is never absent, because every other pillar
 * joins the crew through it.
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createProfilesService } = require("./service");
const { seedProfiles } = require("./seed");
const { getStore, read, RESOURCE, FILE, DEFAULT_DATA } = require("./store");

// SDL lives in a .graphql file so an editor highlights it and a reviewer reads it
// as a schema rather than as a string literal.
const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "profiles",
  foundation: true,
  dependsOn: [],
  typeDefs,
  resolvers,
  createService: createProfilesService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  seed: (options) => seedProfiles(options),

  /**
   * Health without creating the store: a probe must never be the thing that
   * brings a data file into existence (§6.6).
   */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { profiles } = await read(getStore());
      return { status: "ok", detail: `${profiles.length} profile(s)` };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
