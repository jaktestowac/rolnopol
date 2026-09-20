/**
 * Shared setup for the Crew Office integration suites.
 *
 * Exists mainly to make §14.6's flakiness protocol cheap to honour:
 *   - flags are snapshotted and restored per suite, so a crew suite never leaves
 *     the module enabled for whatever runs next;
 *   - crew stores are reset per suite, because they are deliberately EXCLUDED
 *     from `database-base-state.json` (§6.6) and therefore survive the test-env
 *     restore that cleans every other store. Without this, suites would depend on
 *     execution order.
 */
const request = require("supertest");
const fs = require("fs");
const path = require("path");

const app = require("../../api/index.js");
const tokenHelpers = require("../../helpers/token.helpers.js");

const FLAG = "crewOfficeEnabled";
const GRAPH = "/api/graphql/crew";
const DATA_DIR = path.join(__dirname, "..", "..", "data");
// Every store file the module could ever own, for the "flag off ⇒ no footprint"
// assertion. Reset shapes come from the pillar manifests instead — see below.
const CREW_STORE_FILES = [
  "crew-profiles.json",
  "crew-work.json",
  "crew-leave.json",
  "crew-training.json",
  "crew-tools.json",
  "crew-documents.json",
];
/** The documents pillar is the only one with a footprint that is not a JSON file. */
const CREW_BLOB_DIR = "crew-documents";

async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setCrewEnabled(enabled) {
  await setFlags({ [FLAG]: enabled });
}

/**
 * Set arbitrary flags for the duration of a suite.
 *
 * Exists because §14.6 says a crew test must not depend on global flag state, and
 * some crew behaviour is a function of ANOTHER module's flag — the AgriAcademy
 * link is the only case today. A test asserting "the link reports DISABLED" has to
 * turn `agriAcademyEnabled` off itself rather than hoping it is off, or it passes
 * or fails depending on what ran before it. Suites already snapshot and restore
 * every flag around themselves, so this is safe to call mid-suite.
 */
async function setFlags(flags) {
  await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
}

async function restoreFlags(flags) {
  if (flags) await request(app).put("/api/v1/feature-flags").send({ flags });
}

/** A valid session token for an arbitrary user id. */
function tokenFor(userId) {
  return tokenHelpers.generateToken(userId);
}

/**
 * Empty every crew store, on disk AND in the in-memory singleton.
 *
 * The store list comes from the assembled pillars' own manifests rather than a
 * hand-kept list here, so a new pillar's store is reset automatically the moment
 * it is registered. An earlier version hard-coded the shapes and silently skipped
 * the work store, which let one suite's duty types leak into the next.
 *
 * Deleting the file would not be enough: `dbManager` caches one JSONDatabase per
 * file for the process and has already loaded its contents. Writing through the
 * instance is what actually resets the state a request will see.
 */
async function resetCrewStores() {
  const dbManager = require("../../data/database-manager");
  const { getCrewSchema, resetSeedState } = require("../../services/crew/registry");

  const { pillars } = getCrewSchema();
  for (const pillar of pillars) {
    for (const store of pillar.stores || []) {
      const instance = dbManager.getDatabase(store.resource, store.file, store.defaultData);
      // A deep clone, so a reset can never hand the pillar its own default object
      // to mutate.
      await instance.write(JSON.parse(JSON.stringify(store.defaultData)));
    }
  }

  // Documents keep their bytes outside the JSON store, so emptying the store alone
  // would leave a growing pile of blobs behind every suite that uploads.
  const blobDir = path.join(DATA_DIR, CREW_BLOB_DIR);
  if (fs.existsSync(blobDir)) fs.rmSync(blobDir, { recursive: true, force: true });

  // A reset store must be seedable again, or the next suite starts empty by
  // accident rather than by choice.
  resetSeedState();
}

/** Which crew store files currently exist on disk. */
function crewStoreFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((name) => /^crew-.*\.json$/.test(name));
}

/**
 * POST one GraphQL operation.
 *
 * @param {object} options
 * @param {string} options.query
 * @param {object} [options.variables]
 * @param {string} [options.token] - omit for an anonymous request
 */
function graph({ query, variables, operationName, token }) {
  const req = request(app).post(GRAPH).set("Content-Type", "application/json");
  if (token) req.set("Cookie", `rolnopolToken=${token}`);
  return req.send({ query, variables, operationName });
}

/**
 * POST one GraphQL operation as a multipart upload, per the GraphQL multipart
 * request specification.
 *
 * The body is assembled by hand rather than with supertest's `.attach()`, and that
 * is the point: `.attach()` would build a plain form post, and the thing under test
 * is the `operations` + `map` + parts framing itself. A test that let a helper
 * invent the framing would pass against a server that accepted the wrong one.
 *
 * @param {object} options
 * @param {string} options.query
 * @param {object} options.variables - with `null` wherever a file goes
 * @param {object} options.map - { partName: ["variables.path"] }, spec-shaped
 * @param {Array<{part,filename,contentType,body}>} options.files
 * @param {boolean} [options.uploadHeader=true] - send x-crew-upload (the CSRF guard)
 */
function graphUpload({ query, variables, operationName, map, files = [], token, uploadHeader = true, boundary = "----crewtest" }) {
  const chunks = [];
  const push = (name, value, { filename, contentType } = {}) => {
    // A filename with a quote or a non-ASCII character cannot go in the quoted
    // form — it would end the string early or arrive mojibaked. Browsers send
    // `filename*` (RFC 5987) for exactly those, so the harness does too: a test
    // that only ever sent plain ASCII would never exercise the parser's real path.
    const needsExtended = filename !== undefined && /[^\x20-\x7e]|["\\]/.test(filename);
    const encoded = needsExtended
      ? `filename*=UTF-8''${encodeURIComponent(filename).replace(/['()!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
      : filename === undefined
        ? null
        : `filename="${filename}"`;
    const disposition = encoded === null ? `name="${name}"` : `name="${name}"; ${encoded}`;
    const headers = [`Content-Disposition: form-data; ${disposition}`];
    if (contentType) headers.push(`Content-Type: ${contentType}`);
    chunks.push(Buffer.from(`--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n`, "utf8"));
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  };

  push("operations", JSON.stringify({ query, variables, operationName }));
  push("map", JSON.stringify(map || {}));
  for (const file of files) {
    push(file.part, file.body, { filename: file.filename, contentType: file.contentType });
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));

  const req = request(app).post(GRAPH).set("Content-Type", `multipart/form-data; boundary=${boundary}`);
  if (uploadHeader) req.set("x-crew-upload", "1");
  if (token) req.set("Cookie", `rolnopolToken=${token}`);
  return req.send(Buffer.concat(chunks));
}

/**
 * The common case: attach N files to one member and return the mutation payload.
 *
 * Builds the `map` from the file list so a test never has to keep two lists in
 * step — a mismatch there is a test bug that looks like a server bug.
 */
async function uploadDocuments({ token, staffId, kind, files, selection = UPLOAD_SELECTION }) {
  const map = {};
  files.forEach((_file, index) => {
    map[String(index)] = [`variables.input.files.${index}`];
  });

  const res = await graphUpload({
    query: `mutation Upload($input: UploadCrewDocumentsInput!) { uploadCrewDocuments(input: $input) ${selection} }`,
    variables: { input: { staffId: String(staffId), ...(kind ? { kind } : {}), files: files.map(() => null) } },
    map,
    files: files.map((file, index) => ({ part: String(index), ...file })),
    token,
  });
  return res;
}

const UPLOAD_SELECTION = `{
  staffId
  accepted { id filename contentType sizeBytes checksum status kind scanCompletesAt downloadPath previewable previewPath }
  rejected { filename code reason sizeBytes }
  folder { totalCount totalBytes items { id filename status previewable previewPath } }
}`;

/** Assert a 200 with no `errors`, and return `data`. Fails loudly with the errors. */
async function graphData(options) {
  const res = await graph(options);
  if (res.status !== 200 || res.body.errors) {
    throw new Error(`GraphQL request failed (${res.status}): ${JSON.stringify(res.body.errors || res.body)}`);
  }
  return res.body.data;
}

/** Register + log in a real user, so tests can own separate staff sets. */
async function registerAndLogin(prefix) {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "crewpass123";
  await request(app)
    .post("/api/v1/register")
    .send({ email, password, displayedName: `${prefix}-user` });
  const res = await request(app).post("/api/v1/login").send({ email, password }).expect(200);
  return { token: res.body?.data?.token, userId: res.body?.data?.user?.id, email };
}

const HIRE_MUTATION = `
  mutation Hire($input: HireCrewMemberInput!) {
    hireCrewMember(input: $input) {
      __typename
      ... on CrewMemberHired { crewMember { staffId name surname age profile { role fte version employmentStatus } } }
      ... on CrewMemberHiredWithoutProfile { staffId reason code }
      ... on HireValidationFailed { fieldErrors { field message } }
    }
  }
`;

const VALID_HIRE_INPUT = {
  name: "Halina",
  surname: "Kowalska",
  age: 34,
  role: "TRACTOR_DRIVER",
  employmentType: "PERMANENT",
  fte: 1.0,
  contractedHoursPerWeek: 40,
  startDate: "2026-03-01",
};

module.exports = {
  app,
  FLAG,
  GRAPH,
  CREW_STORE_FILES,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
  getFlags,
  setCrewEnabled,
  setFlags,
  restoreFlags,
  tokenFor,
  resetCrewStores,
  crewStoreFiles,
  graph,
  graphData,
  graphUpload,
  uploadDocuments,
  UPLOAD_SELECTION,
  CREW_BLOB_DIR,
  registerAndLogin,
};
