/**
 * Work pillar manifest (PRD §11).
 *
 * The proof that the extension contract is real: adding this pillar took one
 * directory and one line in `registry.js`. No change to the executor, the router,
 * the controller, `CrewMember`'s base fields, or the profiles pillar.
 *
 * It depends on `profiles` because a shift belongs to a crew member, and the
 * member lookup lives there. A missing hard dependency drops the pillar rather
 * than half-assembling it (see registry.js).
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createWorkService } = require("./service");
const { seedWork } = require("./seed");
const { getStore, read, RESOURCE, FILE, DEFAULT_DATA } = require("./store");

const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "work",
  foundation: false,
  dependsOn: ["profiles"],
  typeDefs,
  resolvers,
  createService: createWorkService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  seed: (options) => seedWork(options),

  /** Health without creating the store — a probe must not be what brings it into being. */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { dutyTypes, shifts, workLog } = await read(getStore());
      return { status: "ok", detail: `${dutyTypes.length} duty type(s), ${shifts.length} shift(s), ${workLog.length} log row(s)` };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
