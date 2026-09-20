/**
 * Leave pillar manifest (PRD §11).
 *
 * The third pillar, added the same way as the second: one directory and one line
 * in `registry.js`. No change to the executor, the router, the controller,
 * `CrewMember`'s base fields, or either pillar already there.
 *
 * It depends on `profiles` because accrual is pro-rata to a contract — `fte` and
 * `startDate` — and `staff.json` carries neither (§3). A missing hard dependency
 * drops the pillar rather than half-assembling it, because a `balance` computed
 * without an FTE would be a confident wrong number.
 *
 * It does NOT depend on `work`, in either direction. The two cross-pillar links —
 * work refusing a shift that clashes with approved leave, and leave warning about
 * shifts already rostered — both go through `context.services.<name>` and are
 * guarded on that service existing. Either pillar works alone.
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createLeaveService } = require("./service");
const { seedLeave } = require("./seed");
const { getStore, read, RESOURCE, FILE, DEFAULT_DATA } = require("./store");

const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "leave",
  foundation: false,
  dependsOn: ["profiles"],
  typeDefs,
  resolvers,
  createService: createLeaveService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  seed: (options) => seedLeave(options),

  /** Health without creating the store — a probe must not be what brings it into being. */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { policies, requests, adjustments } = await read(getStore());
      return {
        status: "ok",
        detail: `${policies.length} policy/policies, ${requests.length} request(s), ${adjustments.length} adjustment(s)`,
      };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
