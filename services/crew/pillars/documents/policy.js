/**
 * What a personnel file will and will not accept, and what the scan does to it.
 *
 * Kept out of `service.js` because these are two separable decisions: the service
 * owns scoping, ordering and persistence, this file owns the rules. A rule change
 * lands here and nowhere else, and the matrix below is what the validation tests
 * sweep.
 */

/** Per file. Small on purpose — a personnel document is a scan, not a video. */
const MAX_FILE_BYTES = 1024 * 1024;
/** Per request. Beyond this the caller is doing something other than filing papers. */
const MAX_FILES_PER_UPLOAD = 5;

/**
 * The allow-list, extension → the content types that may claim it.
 *
 * An allow-list and not a deny-list: the set of dangerous extensions is open and
 * grows without asking, while the set of things a personnel file legitimately
 * holds is short and known. A deny-list is how `.svg` (script-bearing) and
 * `.htm` end up accepted by an upload nobody meant to make executable.
 *
 * The extension AND the declared type both have to agree. Checking one alone is
 * the classic hole: `payload.pdf` sent as `text/html` is served back as the type
 * the record kept, and a browser will render it.
 */
const ALLOWED_TYPES = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".txt": ["text/plain"],
  ".csv": ["text/csv", "text/plain"],
};

/** How long the scan takes. Long enough that a test must poll rather than sleep once. */
const SCAN_DURATION_MS = 3000;

/**
 * Which types may be rendered IN the page rather than only saved.
 *
 * A narrower list than the upload allow-list, and the gap is the point. Serving a
 * file inline means a browser renders caller-supplied bytes inside this app's own
 * origin, so the question stops being "is this a sensible document?" and becomes
 * "can this execute?".
 *
 *   pdf, png, jpeg   render, cannot script. Browsers run PDFs in a sandboxed
 *                    built-in viewer, and an image is an image.
 *   text/plain,      served with the recorded type and `nosniff`, a .txt holding
 *   text/csv         `<script>` is TEXT — the browser is forbidden from guessing
 *                    otherwise. Remove the nosniff header and this line becomes a
 *                    stored-XSS hole, which is why the two travel together.
 *
 * Nothing else. `image/svg+xml` is the type this list is shaped to exclude — SVG
 * carries script and renders as an image, so it looks harmless in exactly the way
 * that matters. It is not on the upload allow-list either; this is the second lock
 * on the same door.
 */
const PREVIEWABLE_TYPES = ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"];

const isPreviewable = (contentType) => PREVIEWABLE_TYPES.includes(String(contentType || "").toLowerCase());

/**
 * A file whose name says it is bad news, so the REJECTED branch is reachable.
 *
 * A practice target needs its failure states to be producible on demand. A real
 * scanner is a service and a signature database; this is a marker in the name, and
 * being obvious about that in the code is better than a mystery heuristic.
 */
const QUARANTINE_MARKER = /quarantine|eicar|infected/i;

const DOCUMENT_KINDS = ["CONTRACT", "CERTIFICATE", "LICENCE", "IDENTITY", "OTHER"];

// Its own module — see the note there for why a control-character class does not
// belong in a file anything else has to read.
const { sanitiseFilename } = require("./sanitise-name");

function extensionOf(filename) {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * Judge one file.
 *
 * @returns {{ ok: true, filename, extension, contentType }
 *          | { ok: false, code, reason, filename, sizeBytes }}
 */
function validateFile(file) {
  const filename = sanitiseFilename(file?.filename);
  const bytes = file?.bytes;
  const sizeBytes = bytes ? bytes.length : 0;

  if (filename.length === 0) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      reason: "The file has no usable name.",
      filename: String(file?.filename ?? ""),
      sizeBytes,
    };
  }
  if (sizeBytes === 0) {
    return { ok: false, code: "EMPTY_FILE", reason: "The file is empty.", filename, sizeBytes };
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      reason: `The file is ${sizeBytes} bytes; the limit is ${MAX_FILE_BYTES}.`,
      filename,
      sizeBytes,
    };
  }

  const extension = extensionOf(filename);
  const allowed = ALLOWED_TYPES[extension];
  if (!allowed) {
    return {
      ok: false,
      code: "UNSUPPORTED_EXTENSION",
      reason: `"${extension || "no extension"}" is not accepted. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}.`,
      filename,
      sizeBytes,
    };
  }

  const declared = String(file?.mimeType || "").toLowerCase();
  if (!allowed.includes(declared)) {
    return {
      ok: false,
      code: "TYPE_MISMATCH",
      reason: `A ${extension} file must be sent as ${allowed.join(" or ")}, not ${declared || "an unset type"}.`,
      filename,
      sizeBytes,
    };
  }

  return { ok: true, filename, extension, contentType: declared, sizeBytes };
}

/** What the scan will decide, fixed at upload time and revealed when it completes. */
function scanOutcomeFor(filename) {
  if (QUARANTINE_MARKER.test(filename)) {
    return { outcome: "rejected", detail: "The scan flagged this file and it will not be served." };
  }
  return { outcome: "clean", detail: null };
}

/**
 * A stored record's status right now.
 *
 * Derived, never stored — which is what makes it survive a restart, behave under a
 * fixed clock, and need no timer. The order matters: a document is PENDING until
 * its scan window closes even when the outcome is already known, because
 * pretending to know the answer early would remove the very wait the state exists
 * to model.
 */
function statusOf(record, nowMs, { bytesPresent = true } = {}) {
  const completesAt = Date.parse(record?.scanCompletesAt);
  if (Number.isFinite(completesAt) && nowMs < completesAt) return "PENDING";
  if (record?.scan?.outcome === "rejected") return "REJECTED";
  // A record whose bytes are gone. Reported rather than hidden, and reported HERE
  // rather than only at download time, because a row that offers a button which can
  // only fail is worse than a row that explains itself. Ordered last on purpose: a
  // rejected document's missing bytes are not news, and a pending one has not been
  // written yet at all.
  return bytesPresent ? "AVAILABLE" : "MISSING";
}

module.exports = {
  PREVIEWABLE_TYPES,
  isPreviewable,
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  ALLOWED_TYPES,
  SCAN_DURATION_MS,
  QUARANTINE_MARKER,
  DOCUMENT_KINDS,
  sanitiseFilename,
  extensionOf,
  validateFile,
  scanOutcomeFor,
  statusOf,
};
