/**
 * Training pillar manifest (PRD §11).
 *
 * The fourth pillar, added the same way as the third: one directory and one line in
 * `registry.js`. No change to the executor, the router, the controller,
 * `CrewMember`'s base fields, or any pillar already there.
 *
 * It depends on `profiles` because compliance is a question about a ROLE — which
 * mandatory courses apply to a member is read off their profile, and `staff.json`
 * carries no role (§3). A missing hard dependency drops the pillar rather than
 * half-assembling it, because a compliance report that could not see roles would
 * confidently declare everybody compliant.
 *
 * It does NOT depend on `tools`, and tools will not depend on it either. The
 * certification gate Phase 6 adds reaches this pillar through
 * `context.services.training.evaluateCertification`, guarded on that service
 * existing — and when it is absent the gate must FAIL CLOSED (§8.5). That is the
 * one cross-pillar link in this module where "the other pillar is switched off" and
 * "the check said no" have to lead to the same refusal.
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createTrainingService } = require("./service");
const { seedTraining } = require("./seed");
const { getStore, read, RESOURCE, FILE, DEFAULT_DATA } = require("./store");

const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "training",
  foundation: false,
  dependsOn: ["profiles"],
  typeDefs,
  resolvers,
  createService: createTrainingService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  seed: (options) => seedTraining(options),

  /** Health without creating the store — a probe must not be what brings it into being. */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { courses, enrollments, certifications } = await read(getStore());
      return {
        status: "ok",
        detail: `${courses.length} course(s), ${enrollments.length} enrollment(s), ${certifications.length} certification(s)`,
      };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
