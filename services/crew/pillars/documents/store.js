/**
 * The documents store — metadata in JSON, bytes on disk.
 *
 * **Why the split.** Every other crew store keeps the whole record in its JSON
 * document, and doing that here would mean base64 in `crew-documents.json`. Three
 * reasons not to: the file is read whole on every query, so a few megabytes of
 * base64 makes every unrelated read pay for it; base64 inflates by a third; and a
 * hand-edited store file is a supported situation in this repo, which stops being
 * true once a line is 400 KB of encoding.
 *
 * So the JSON holds the record and the bytes live in `data/crew-documents/`, one
 * file per document, named from the document id and NEVER from the uploaded
 * filename. That naming is a security property, not tidiness: the uploaded name is
 * caller-controlled and would otherwise be a path-traversal sink. It is kept for
 * display and for the download header, and it never touches the filesystem.
 *
 * Neither the directory nor the JSON exists until the first upload, which keeps
 * §12 rule 1 true — a disabled module leaves no filesystem footprint.
 */
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const dbManager = require("../../../../data/database-manager");
const { withStoreLock } = require("../../serialise");

const RESOURCE = "crewDocuments";
const FILE = "crew-documents.json";
const BLOB_DIR = "crew-documents";
const DEFAULT_DATA = { documents: [], counters: { lastDocumentId: 0 } };

const DATA_DIR = path.join(__dirname, "..", "..", "..", "..", "data");

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, { documents: [], counters: { ...DEFAULT_DATA.counters } });
}

function normalise(data) {
  return {
    documents: Array.isArray(data?.documents) ? data.documents : [],
    counters: { lastDocumentId: Number(data?.counters?.lastDocumentId) || 0 },
  };
}

async function read(store) {
  return normalise(await store.getAll());
}

/**
 * Read-modify-write inside a real critical section.
 *
 * The race here is the id counter: two uploads landing together must not both
 * claim document 7, because the second would overwrite the first's blob. Same
 * shape as the tools ledger — see `serialise.js` for why `store.update()` alone
 * is not enough.
 */
async function transact(store, mutate) {
  return withStoreLock(RESOURCE, async () => {
    let captured;
    await store.update((current) => {
      const document = normalise(current);
      const { document: next, result } = mutate(document);
      captured = result;
      return next;
    });
    return captured;
  });
}

const blobDirPath = () => path.join(DATA_DIR, BLOB_DIR);
/** Derived from the id alone. The uploaded filename never reaches a path. */
const blobNameFor = (documentId) => `crew-document-${documentId}.bin`;
const blobPathFor = (documentId) => path.join(blobDirPath(), blobNameFor(documentId));

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * Write a document's bytes.
 *
 * Deliberately AFTER the metadata row is committed rather than before: a blob with
 * no record is invisible and unreclaimable, while a record whose blob is missing
 * is detectable (the download route reports it) and repairable. Given one of the
 * two has to be able to happen, this is the one worth having.
 */
async function writeBlob(documentId, bytes) {
  await fsp.mkdir(blobDirPath(), { recursive: true });
  await fsp.writeFile(blobPathFor(documentId), bytes);
}

async function readBlob(documentId) {
  return fsp.readFile(blobPathFor(documentId));
}

function blobExists(documentId) {
  try {
    return fs.existsSync(blobPathFor(documentId));
  } catch {
    return false;
  }
}

module.exports = {
  getStore,
  read,
  transact,
  normalise,
  writeBlob,
  readBlob,
  blobExists,
  blobPathFor,
  blobNameFor,
  blobDirPath,
  sha256,
  RESOURCE,
  FILE,
  BLOB_DIR,
  DEFAULT_DATA,
};
