/**
 * Documents service — the personnel file (#100).
 *
 * Scoping lives here, as in every pillar: each read filters by the context's
 * `userId` and each write stamps it, so a second transport cannot skip isolation
 * (§9). The download route reads through `findOwnedDocument` for exactly that
 * reason — it is a different transport, and it must not re-derive ownership.
 *
 * Four decisions worth reading before changing anything.
 *
 *   1. **A batch upload is not atomic, on purpose.** Four good files and one .exe
 *      stores four documents and reports one rejection. The alternative — refuse
 *      the batch — makes a user re-pick five files because of one, and it is the
 *      less useful lesson: partial success is the state clients get wrong.
 *
 *   2. **Validation happens before the lock, persistence inside it.** The lock
 *      exists for the id counter (see `store.js`); holding it across hashing and
 *      byte-writing would serialise every upload behind the slowest one for no
 *      added safety.
 *
 *   3. **Bytes are written AFTER the record commits.** A blob with no record is
 *      invisible and unreclaimable; a record whose blob is missing is detectable
 *      and repairable. One of the two has to be possible, and this is the one
 *      worth having — `readDocumentBytes` reports the gap rather than throwing.
 *
 *   4. **Nothing is ever deleted.** Crew Office has no delete mutation of any kind
 *      (§6.6) and this pillar keeps that: a REJECTED document keeps its row, its
 *      bytes and its reason. "What was uploaded, and what happened to it?" has to
 *      stay answerable.
 */
const { memberNotFound, CrewError, CREW_ERROR_CODES } = require("../../errors");
const { getStore, read, transact, writeBlob, readBlob, blobExists, sha256 } = require("./store");
const {
  MAX_FILES_PER_UPLOAD,
  SCAN_DURATION_MS,
  DOCUMENT_KINDS,
  validateFile,
  scanOutcomeFor,
  statusOf,
  isPreviewable,
} = require("./policy");

const DOWNLOAD_PATH_PREFIX = "/api/v1/crew/documents/";

function createDocumentsService(context) {
  const { clock } = context;
  const store = getStore();

  const readDocument = async () => {
    context.onStoreRead("crewDocuments");
    return read(store);
  };

  /** One read per request, shared by every field that needs the store. */
  const loader = context.addLoader("crewDocumentsDocument", readDocument);
  const invalidate = () => context.resetLoaders("crewDocumentsDocument");

  const ownedRows = async () => {
    const { documents } = await loader.all();
    return documents.filter((row) => Number(row.userId) === context.userId);
  };

  /**
   * The member, or MEMBER_NOT_FOUND.
   *
   * Reads tolerate an orphaned member and writes do not, the same split every
   * other pillar makes (§12 rule 4): a deleted staff record still has a personnel
   * file worth reading, and nothing new may be filed against it.
   */
  async function requireMember(staffId, { allowOrphaned = false } = {}) {
    const member = await context.services.profiles?.findMember(staffId);
    if (!member) throw memberNotFound(staffId);
    if (!member.staff && !allowOrphaned) throw memberNotFound(staffId);
    return member;
  }

  /** A stored row as the graph sees it. Status and the two paths are computed here. */
  function toView(row) {
    const nowMs = clock.now().getTime();
    // One `existsSync` per row per read. Cheap (a stat), bounded (a personnel file
    // is a handful of documents), and the alternative is a folder that cannot tell
    // a usable document from a broken one until somebody clicks it.
    const status = statusOf(row, nowMs, { bytesPresent: blobExists(row.id) });
    // Whether a document may be rendered in the page is a SERVER decision, handed
    // to the client as a boolean. A client that decided for itself would be a
    // second copy of the type list, and the copy that drifts is always the one
    // that decides to render something the server would not have.
    const previewable = isPreviewable(row.contentType);
    return {
      id: String(row.id),
      staffId: String(row.staffId),
      kind: row.kind,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: Number(row.sizeBytes) || 0,
      checksum: row.checksum,
      status,
      scanDetail: status === "REJECTED" ? row.scan?.detail || null : null,
      uploadedAt: row.uploadedAt,
      scanCompletesAt: row.scanCompletesAt,
      downloadPath: `${DOWNLOAD_PATH_PREFIX}${row.id}`,
      previewable,
      // Same route, same ownership and status checks, one query parameter apart —
      // rather than a second endpoint that would have to re-implement both.
      previewPath: previewable ? `${DOWNLOAD_PATH_PREFIX}${row.id}?disposition=inline` : null,
    };
  }

  function toFolder(rows) {
    const items = rows
      // Newest first, id descending as the tie-break — two files picked in one
      // dialog share a timestamp, and a folder that reorders between reads is a
      // folder no test can assert on.
      .slice()
      .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)) || Number(b.id) - Number(a.id))
      .map(toView);
    return {
      items,
      totalCount: items.length,
      totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    };
  }

  return {
    /** Every document filed against one member, oldest write last. */
    async folderFor(staffId) {
      const rows = await ownedRows();
      return toFolder(rows.filter((row) => String(row.staffId) === String(staffId)));
    },

    /** One document, scoped. Null rather than an error — the graph field is nullable. */
    async findDocument(documentId) {
      const rows = await ownedRows();
      const row = rows.find((candidate) => String(candidate.id) === String(documentId));
      return row ? toView(row) : null;
    },

    /**
     * The download path's entry point: the record AND its bytes, or a reason.
     *
     * Deliberately one call rather than "find, then read": every caller needs both,
     * and splitting them is how an ownership check ends up on one path and not the
     * other.
     */
    async readDocumentBytes(documentId) {
      const view = await this.findDocument(documentId);
      if (!view) return { ok: false, code: "NOT_FOUND" };
      if (view.status === "PENDING") return { ok: false, code: "SCAN_PENDING", document: view };
      if (view.status === "REJECTED") return { ok: false, code: "SCAN_REJECTED", document: view };
      // Branching on the status the graph already reported, so the route and the
      // folder can never disagree about whether a document is usable.
      if (view.status === "MISSING") return { ok: false, code: "BLOB_MISSING", document: view };
      return { ok: true, document: view, bytes: await readBlob(documentId) };
    },

    /**
     * Attach files to a member.
     *
     * @param {object} input
     * @param {string} input.staffId
     * @param {string} [input.kind]
     * @param {Array<{filename,mimeType,bytes}>} input.files
     */
    async uploadDocuments({ staffId, kind = "OTHER", files }) {
      context.assertWritableIdentity();
      await requireMember(staffId);

      const documentKind = DOCUMENT_KINDS.includes(String(kind).toUpperCase()) ? String(kind).toUpperCase() : "OTHER";
      const incoming = Array.isArray(files) ? files : [];
      if (incoming.length === 0) {
        throw new CrewError(CREW_ERROR_CODES.VALIDATION_FAILED, "An upload must carry at least one file.", { field: "files" });
      }

      const rejected = [];
      const candidates = [];

      for (const [index, file] of incoming.entries()) {
        // The batch cap refuses the SURPLUS files rather than the request. The
        // caller keeps the first five and is told precisely which ones did not fit,
        // which is a retry they can act on.
        if (index >= MAX_FILES_PER_UPLOAD) {
          rejected.push({
            filename: file?.filename ? String(file.filename) : `file-${index + 1}`,
            code: "TOO_MANY_FILES",
            reason: `An upload may carry at most ${MAX_FILES_PER_UPLOAD} files.`,
            sizeBytes: file?.bytes?.length || 0,
          });
          continue;
        }

        const verdict = validateFile(file);
        if (!verdict.ok) {
          rejected.push({ filename: verdict.filename, code: verdict.code, reason: verdict.reason, sizeBytes: verdict.sizeBytes });
          continue;
        }
        candidates.push({ verdict, bytes: file.bytes });
      }

      const uploadedAt = clock.nowIso();
      const scanCompletesAt = new Date(clock.now().getTime() + SCAN_DURATION_MS).toISOString();

      // One transaction for the whole batch: the id counter must not be handed out
      // twice, and a batch that half-commits its metadata would leave a folder
      // whose totals disagree with its rows.
      const accepted = await transact(store, (document) => {
        let lastDocumentId = document.counters.lastDocumentId;
        const rows = [];

        for (const candidate of candidates) {
          lastDocumentId += 1;
          rows.push({
            id: lastDocumentId,
            userId: context.userId,
            staffId: String(staffId),
            kind: documentKind,
            filename: candidate.verdict.filename,
            contentType: candidate.verdict.contentType,
            sizeBytes: candidate.verdict.sizeBytes,
            checksum: sha256(candidate.bytes),
            uploadedAt,
            scanCompletesAt,
            scan: scanOutcomeFor(candidate.verdict.filename),
          });
        }

        return {
          document: { documents: [...document.documents, ...rows], counters: { lastDocumentId } },
          result: rows,
        };
      });

      // Decision 3: bytes after the record.
      for (const [index, row] of accepted.entries()) {
        await writeBlob(row.id, candidates[index].bytes);
      }

      invalidate();
      const folder = await this.folderFor(staffId);

      return {
        staffId: String(staffId),
        accepted: accepted.map(toView),
        rejected,
        folder,
      };
    },

    /**
     * Rows whose staff record is gone (§12 rule 4).
     *
     * Reported, never cleaned up: the bytes are still the caller's, and a module
     * that deletes on a maintenance query is a module that can lose a contract.
     */
    async findOrphanedOverlays() {
      const rows = await ownedRows();
      if (rows.length === 0) return [];
      const staffById = await context.loaders.staffById.all();
      return rows
        .filter((row) => !staffById.get(Number(row.staffId)))
        .map((row) => ({
          staffId: String(row.staffId),
          rowId: String(row.id),
          detail: `document "${row.filename}"`,
        }));
    },
  };
}

module.exports = { createDocumentsService, DOWNLOAD_PATH_PREFIX };
