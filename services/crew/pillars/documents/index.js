/**
 * Documents pillar manifest (PRD §11) — the personnel file (#100).
 *
 * The sixth pillar, added the way the fifth was: one directory and one line in
 * `registry.js`. No change to the executor, the router, `CrewMember`'s base
 * fields, or any pillar already there.
 *
 * It is the first pillar that needed anything of the CONTROLLER, though, and the
 * distinction is worth being precise about: the controller change admits
 * `multipart/form-data` on the graph endpoint, which is transport, generic, and
 * would be identical for any future pillar that takes bytes. Nothing in
 * `controllers/crew-graphql.controller.js` mentions documents. The extension seam
 * held; the transport simply learned a second content type.
 *
 * `dependsOn: ["profiles"]` is a HARD dependency, unlike tools→training. Here it
 * is the right call: every document hangs off a member, `requireMember` is the
 * ownership check, and a documents pillar without profiles could not answer "is
 * this staff member yours?" at all. Failing closed and failing absent are the
 * same thing when there is nothing to attach to.
 */
const fs = require("fs");
const path = require("path");
const { resolvers } = require("./resolvers");
const { createDocumentsService } = require("./service");
const { getStore, read, RESOURCE, FILE, BLOB_DIR, DEFAULT_DATA, blobDirPath } = require("./store");
const { statusOf } = require("./policy");

const typeDefs = fs.readFileSync(path.join(__dirname, "schema.graphql"), "utf8");

module.exports = {
  name: "documents",
  foundation: false,
  dependsOn: ["profiles"],
  typeDefs,
  resolvers,
  createService: createDocumentsService,
  stores: [{ resource: RESOURCE, file: FILE, defaultData: DEFAULT_DATA }],

  // No seed. Every other pillar can invent plausible demo rows; this one would have
  // to invent FILES, and a module that writes bytes to disk the first time somebody
  // enables a flag is a surprise nobody asked for. An empty personnel file is also
  // the honest starting state.

  /** Health without creating the store — a probe must not be what brings it into being. */
  async health() {
    const filePath = path.join(__dirname, "..", "..", "..", "..", "data", FILE);
    if (!fs.existsSync(filePath)) {
      return { status: "ok", detail: "store not yet created" };
    }
    try {
      const { documents } = await read(getStore());
      const nowMs = Date.now();
      const counts = { PENDING: 0, AVAILABLE: 0, REJECTED: 0 };
      let bytes = 0;
      for (const row of documents) {
        counts[statusOf(row, nowMs)] += 1;
        bytes += Number(row.sizeBytes) || 0;
      }
      // Reported across every owner: health is about the store, and there is no
      // session here to scope to. The blob directory is named because a store that
      // has rows and no directory is the one failure worth spotting from a probe.
      const blobs = fs.existsSync(blobDirPath()) ? fs.readdirSync(blobDirPath()).length : 0;
      return {
        status: documents.length > 0 && blobs === 0 ? "degraded" : "ok",
        detail:
          `${documents.length} document(s) — ${counts.AVAILABLE} available, ${counts.PENDING} scanning, ` +
          `${counts.REJECTED} rejected; ${bytes} byte(s) across ${blobs} blob(s) in data/${BLOB_DIR}/`,
      };
    } catch (error) {
      return { status: "error", detail: error.message };
    }
  },
};
