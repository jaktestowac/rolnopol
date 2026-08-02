/**
 * The GraphQL multipart request specification, implemented over the parser next
 * door (jaydenseric/graphql-multipart-request-spec).
 *
 * GraphQL has no file type — a request is JSON, and JSON has no bytes. The spec's
 * answer is to send a normal multipart body with three kinds of part:
 *
 *     operations  a JSON `{ query, variables, operationName }` in which every file
 *                 position holds `null`
 *     map         a JSON `{ "<partName>": ["variables.path.to.the.null", ...] }`
 *     <partName>  the file itself, one part per file
 *
 * So the client says where the holes are, and the server fills them. A worked
 * example, uploading two documents:
 *
 *     operations: {"query":"mutation($i:UploadCrewDocumentsInput!){...}",
 *                  "variables":{"i":{"staffId":"3","files":[null,null]}}}
 *     map:        {"0":["variables.i.files.0"],"1":["variables.i.files.1"]}
 *     0:          <bytes of contract.pdf>
 *     1:          <bytes of licence.png>
 *
 * Two rules below are worth more than the rest, because both are the difference
 * between an upload endpoint and a vulnerability:
 *
 *   1. **A mapped path must already exist and must already be `null`.** Without
 *      that check `map` becomes an arbitrary-write primitive into the variables of
 *      someone else's operation — it could overwrite `variables.input.staffId`
 *      with a file, or invent fields the client never sent.
 *   2. **Every file part must be claimed by the map, and every map entry must have
 *      a part.** An unclaimed file is bytes the server accepted and cannot explain;
 *      a claimed-but-missing part leaves a `null` where the schema wants an Upload,
 *      and the failure surfaces far from its cause.
 */
const { MultipartError, parseMultipartRequest } = require("./multipart");

/**
 * The brand that makes an upload unforgeable.
 *
 * `Upload`'s `parseValue` accepts only values carrying this symbol, so a plain
 * JSON request cannot hand the resolver an object shaped like a file. The bytes
 * have to have come through the parser above.
 */
const UPLOAD_BRAND = Symbol.for("rolnopol.crew.upload");

function createUpload({ filename, mimeType, bytes }) {
  return {
    [UPLOAD_BRAND]: true,
    filename: String(filename ?? ""),
    mimeType: String(mimeType || "application/octet-stream"),
    bytes,
    get sizeBytes() {
      return bytes.length;
    },
  };
}

const isUpload = (value) => Boolean(value && typeof value === "object" && value[UPLOAD_BRAND] === true);

function parseJsonPart(name, raw) {
  if (raw === undefined) {
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", `A GraphQL multipart request needs a "${name}" part.`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", `The "${name}" part is not valid JSON: ${error.message}`);
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Walk a dotted path and set the leaf, refusing anything that is not already a
 * `null` hole. See rule 1 above — this function is the whole of it.
 */
function fillHole(operations, path, upload) {
  const segments = String(path).split(".");
  if (segments.length < 2 || segments[0] !== "variables") {
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", `Map path "${path}" must start with "variables".`);
  }

  let cursor = operations;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    const next = Array.isArray(cursor) ? cursor[Number(key)] : isPlainObject(cursor) ? cursor[key] : undefined;
    if (next === undefined || next === null) {
      throw new MultipartError("MULTIPART_SPEC_VIOLATION", `Map path "${path}" does not exist in the operation.`);
    }
    cursor = next;
  }

  const leaf = segments[segments.length - 1];
  const container = cursor;
  const currentValue = Array.isArray(container) ? container[Number(leaf)] : isPlainObject(container) ? container[leaf] : undefined;

  if (currentValue !== null) {
    // Either the path names something that is not a file hole, or it names a hole
    // that another map entry already filled. Both are refusals, not overwrites.
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", `Map path "${path}" must point at a null placeholder.`);
  }

  if (Array.isArray(container)) container[Number(leaf)] = upload;
  else container[leaf] = upload;
}

/**
 * Turn a multipart request into the operation the executor already knows how to
 * run — `{ query, variables, operationName }`, with real files where the nulls
 * were.
 */
async function readGraphQLMultipartRequest(req, limits = {}) {
  const { fields, files } = await parseMultipartRequest(req, limits);

  const operations = parseJsonPart("operations", fields.get("operations"));
  const map = parseJsonPart("map", fields.get("map"));

  if (!isPlainObject(operations)) {
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", 'The "operations" part must be a JSON object.');
  }
  if (!isPlainObject(map)) {
    throw new MultipartError("MULTIPART_SPEC_VIOLATION", 'The "map" part must be a JSON object.');
  }

  const claimed = new Set();
  for (const [partName, paths] of Object.entries(map)) {
    const file = files.get(partName);
    if (!file) {
      throw new MultipartError("MULTIPART_SPEC_VIOLATION", `The map names part "${partName}", which the request does not carry.`);
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new MultipartError("MULTIPART_SPEC_VIOLATION", `Map entry "${partName}" must be a non-empty array of paths.`);
    }
    claimed.add(partName);

    // One file may legitimately fill several holes — the spec allows it, and it is
    // how a client avoids sending the same bytes twice.
    const upload = createUpload(file);
    for (const path of paths) fillHole(operations, path, upload);
  }

  for (const partName of files.keys()) {
    if (!claimed.has(partName)) {
      throw new MultipartError("MULTIPART_SPEC_VIOLATION", `File part "${partName}" is not referenced by the map.`);
    }
  }

  return {
    query: operations.query,
    variables: operations.variables,
    operationName: operations.operationName,
  };
}

module.exports = {
  UPLOAD_BRAND,
  createUpload,
  isUpload,
  fillHole,
  readGraphQLMultipartRequest,
};
