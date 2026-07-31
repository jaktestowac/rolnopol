/**
 * Tools pillar manifest (PRD §11).
 *
 * The fifth pillar, added the same way as the fourth: one directory and one line in
 * `registry.js`. No change to the executor, the router, the controller,
 * `CrewMember`'s base fields, or any pillar already there.
 *
 * **`dependsOn` is `["profiles"]` and NOT `["profiles", "training"]`, deliberately.**
 * The certification gate (§8.5) is the module's one genuine cross-pillar rule, and
 * the instinct is to declare training as a dependency so the gate always has
 * something to ask. That instinct is exactly backwards here. A hard dependency means
 * a training pillar that failed to load takes the tools pillar with it — and a tools
 * pillar that is not there issues nothing, which looks like safety but is really the
 * gate having been removed along with the tool registry. What §8.5 asks for is the
 * opposite: the tools pillar present, the gate present, and every issue of a
 * certification-controlled tool REFUSED with `CertificationCheckUnavailable` while
 * the records cannot be reached.
 *
 * So the link is a soft one, made at request time through
 * `context.services.training.evaluateCertification` and guarded on that service
 * existing (see `evaluateGate` in `service.js`). The SDL keeps its side of the
 * bargain too: nothing in `schema.graphql` names a type the training pillar declares,
 * because an SDL reference would reintroduce the hard dependency through the back
 * door and break assembly rather than fail closed.
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createToolsService } = require("./service");
const { seedTools } = require("./seed");
const { getStore, read, RESOURCE, FILE, DEFAULT_DATA } = require("./store");
const { openIssuances, overdueIssuances } = require("./ledger");

const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "tools",
  foundation: false,
  dependsOn: ["profiles"],
  typeDefs,
  resolvers,
  createService: createToolsService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  seed: (options) => seedTools(options),

  /** Health without creating the store — a probe must not be what brings it into being. */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { tools, issuances, serviceRecords } = await read(getStore());
      // Reported across every owner, because health is about the store rather than
      // about a caller — there is no session here to scope to. The overdue count is
      // included because it is the one number an operator would want from a probe.
      const open = openIssuances(issuances).length;
      const overdue = overdueIssuances(issuances, new Date().toISOString().slice(0, 10)).length;
      return {
        status: "ok",
        detail: `${tools.length} tool(s), ${issuances.length} issuance(s) (${open} open, ${overdue} overdue), ${serviceRecords.length} service record(s)`,
      };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
