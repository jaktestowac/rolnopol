/**
 * A `multipart/form-data` parser, hand-rolled (PRD-adjacent: new-ideas.md #64).
 *
 * No `multer`, no `busboy`, no new dependency — the house rule is that the app
 * still works after `npm i` with nothing added, and a parser is a bounded amount
 * of code once the format is read properly. RFC 7578 is short; the shape is:
 *
 *     --BOUNDARY CRLF
 *     Header: value CRLF
 *     (more headers) CRLF
 *     CRLF                      <- one blank line ends the headers
 *     ...raw bytes...           <- the part body, byte-exact
 *     CRLF--BOUNDARY CRLF       <- next part
 *     ...
 *     CRLF--BOUNDARY--          <- the epilogue marker ends the body
 *
 * Three details that a naive implementation gets wrong, and that the tests here
 * exist to pin:
 *
 *   1. **The delimiter includes the CRLF that precedes it.** `--BOUNDARY` can
 *      legitimately appear inside a file's bytes; `CRLF--BOUNDARY` at a part
 *      boundary cannot, because the trailing CRLF belongs to the delimiter and not
 *      to the body. Searching for the short form corrupts any upload that happens
 *      to contain the boundary text — a PNG eventually will.
 *   2. **A part body is bytes, not text.** Nothing here calls `toString()` on a
 *      file body. Decoding to UTF-8 and back mangles every byte outside ASCII,
 *      which is most of a binary file.
 *   3. **The size cap is enforced while reading, not after.** A cap checked once
 *      the body is in memory is not a cap; the process has already paid for it.
 *
 * Everything here is transport. It knows about parts and headers, and nothing at
 * all about GraphQL — that layer is `graphql-multipart.js`.
 */

/** Thrown for anything a caller could have sent differently. Carries an HTTP status. */
class MultipartError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MultipartError";
    this.code = code;
    this.status = status;
  }
}

const CRLF = Buffer.from("\r\n");
const DOUBLE_CRLF = Buffer.from("\r\n\r\n");
const DASH_DASH = Buffer.from("--");

/**
 * Pull the boundary out of a Content-Type header.
 *
 * Quoted form (`boundary="abc"`) is legal and some clients use it, so both are
 * accepted. A boundary is required: without one the body cannot be split at all,
 * and guessing is not an option.
 */
function parseContentType(header) {
  const raw = String(header || "");
  const [type] = raw.split(";");
  const mediaType = type.trim().toLowerCase();
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(raw);
  const boundary = match ? match[1] || match[2] : null;
  return { mediaType, boundary };
}

function isMultipartFormData(header) {
  return parseContentType(header).mediaType === "multipart/form-data";
}

/**
 * Buffer the request body, refusing as soon as the cap is passed.
 *
 * The early refusal is the point: an oversized upload is rejected after
 * `maxTotalBytes` have arrived, not after all of it has. The request is destroyed
 * rather than drained, because continuing to read a body already known to be too
 * large is exactly the cost the cap exists to avoid.
 */
function readBody(req, maxTotalBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk) {
      received += chunk.length;
      if (received > maxTotalBytes) {
        finish(new MultipartError("REQUEST_TOO_LARGE", `Upload exceeds ${maxTotalBytes} bytes.`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      finish(null, Buffer.concat(chunks, received));
    }
    function onError(error) {
      finish(new MultipartError("REQUEST_STREAM_FAILED", `Upload stream failed: ${error.message}`, 400));
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** `a: b\r\nc: d` → Map { "a" => "b", "c" => "d" }. Names are lower-cased. */
function parseHeaders(block) {
  const headers = new Map();
  for (const line of block.toString("utf8").split("\r\n")) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/**
 * The parameters of a Content-Disposition header.
 *
 * `filename*` (RFC 5987, `UTF-8''na%C3%AFve.pdf`) wins over plain `filename` when
 * both are present, which is what a browser sends for a non-ASCII name. Getting
 * this wrong is how "naïve.pdf" becomes "naÃ¯ve.pdf" on the way in — and the
 * download side has the mirror-image problem.
 */
function parseDisposition(value) {
  const raw = String(value || "");
  const out = { name: null, filename: null };

  const name = /;\s*name="([^"]*)"/i.exec(raw) || /;\s*name=([^;]+)/i.exec(raw);
  if (name) out.name = (name[1] || "").trim();

  const extended = /;\s*filename\*=([^;]+)/i.exec(raw);
  if (extended) {
    const [, , encoded] = extended[1].trim().split("'");
    if (encoded !== undefined) {
      try {
        out.filename = decodeURIComponent(encoded);
      } catch {
        out.filename = encoded;
      }
    }
  }
  if (out.filename == null) {
    const plain = /;\s*filename="([^"]*)"/i.exec(raw) || /;\s*filename=([^;]+)/i.exec(raw);
    if (plain) out.filename = (plain[1] || "").trim();
  }

  return out;
}

/**
 * Split a buffered body into its parts.
 *
 * @returns {Array<{ headers: Map, body: Buffer }>}
 */
function splitParts(body, boundary) {
  // Prepending a CRLF lets the first delimiter be found with the same search as
  // every other one — the opening `--BOUNDARY` has no CRLF in front of it in the
  // wire format, and special-casing it is where off-by-one bugs live.
  const buffer = Buffer.concat([CRLF, body]);
  const delimiter = Buffer.concat([CRLF, DASH_DASH, Buffer.from(boundary, "utf8")]);

  const parts = [];
  let cursor = buffer.indexOf(delimiter);
  if (cursor < 0) throw new MultipartError("MULTIPART_MALFORMED", "No boundary delimiter found in the body.");

  while (cursor >= 0) {
    const afterDelimiter = cursor + delimiter.length;

    // `--BOUNDARY--` closes the body; anything after it is an epilogue we ignore.
    if (buffer.slice(afterDelimiter, afterDelimiter + 2).equals(DASH_DASH)) break;

    const headerStart = buffer.indexOf(CRLF, afterDelimiter);
    if (headerStart < 0) throw new MultipartError("MULTIPART_MALFORMED", "A part is missing its header block.");

    const headerEnd = buffer.indexOf(DOUBLE_CRLF, headerStart);
    if (headerEnd < 0) throw new MultipartError("MULTIPART_MALFORMED", "A part's headers are not terminated.");

    const bodyStart = headerEnd + DOUBLE_CRLF.length;
    const next = buffer.indexOf(delimiter, bodyStart);
    if (next < 0) throw new MultipartError("MULTIPART_MALFORMED", "A part is not closed by a delimiter.");

    parts.push({
      headers: parseHeaders(buffer.slice(headerStart + CRLF.length, headerEnd)),
      body: buffer.slice(bodyStart, next),
    });

    cursor = next;
  }

  return parts;
}

/**
 * Parse a multipart request into named fields and named files.
 *
 * Files keep their bytes verbatim. Fields are decoded as UTF-8 text and capped
 * separately from files, because a field is meant to hold a small JSON document
 * and a megabyte of it is not a document, it is an attack.
 *
 * @returns {{ fields: Map<string,string>, files: Map<string,{filename,mimeType,bytes}> }}
 */
async function parseMultipartRequest(req, limits = {}) {
  const { maxTotalBytes = 8 * 1024 * 1024, maxFieldBytes = 64 * 1024, maxParts = 32 } = limits;

  const { mediaType, boundary } = parseContentType(req.headers["content-type"]);
  if (mediaType !== "multipart/form-data") {
    throw new MultipartError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be multipart/form-data.", 415);
  }
  if (!boundary) {
    throw new MultipartError("MULTIPART_MALFORMED", "multipart/form-data requires a boundary parameter.");
  }

  const body = await readBody(req, maxTotalBytes);
  const parts = splitParts(body, boundary);
  if (parts.length > maxParts) {
    throw new MultipartError("TOO_MANY_PARTS", `A request may carry at most ${maxParts} parts.`, 413);
  }

  const fields = new Map();
  const files = new Map();

  for (const part of parts) {
    const disposition = parseDisposition(part.headers.get("content-disposition"));
    if (!disposition.name) {
      throw new MultipartError("MULTIPART_MALFORMED", "Every part needs a Content-Disposition name.");
    }

    // A part is a FILE when it carries a filename, even an empty one. That is the
    // spec's own distinction, and it is what lets an empty upload be reported as a
    // rejected file rather than silently read as a blank text field.
    if (disposition.filename !== null) {
      files.set(disposition.name, {
        filename: disposition.filename,
        mimeType: (part.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase(),
        bytes: part.body,
      });
      continue;
    }

    if (part.body.length > maxFieldBytes) {
      throw new MultipartError("FIELD_TOO_LARGE", `Field "${disposition.name}" exceeds ${maxFieldBytes} bytes.`, 413);
    }
    fields.set(disposition.name, part.body.toString("utf8"));
  }

  return { fields, files };
}

module.exports = {
  MultipartError,
  parseContentType,
  isMultipartFormData,
  parseDisposition,
  parseHeaders,
  splitParts,
  readBody,
  parseMultipartRequest,
};
