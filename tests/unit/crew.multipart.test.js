import { describe, it, expect } from "vitest";
import { Readable } from "stream";

/**
 * The hand-rolled multipart parser and the GraphQL multipart spec layer.
 *
 * Unit tests rather than another pass through the endpoint, because the cases that
 * matter here are the ones a well-behaved client never sends: a boundary inside a
 * file's bytes, a part with no name, a map that aims at the wrong variable. The
 * integration suite proves the happy path end to end; this one proves the parser
 * is not merely lucky.
 */
const {
  MultipartError,
  parseContentType,
  parseDisposition,
  splitParts,
  readBody,
  parseMultipartRequest,
} = require("../../services/crew/upload/multipart");
const { readGraphQLMultipartRequest, fillHole, isUpload, createUpload } = require("../../services/crew/upload/graphql-multipart");
const { contentDispositionAttachment, toAsciiFallback, encodeRfc5987 } = require("../../services/crew/upload/content-disposition");

const BOUNDARY = "xBOUNDARYx";

/** Build a body the way a client would, so the tests exercise real framing. */
function buildBody(parts, boundary = BOUNDARY) {
  const chunks = [];
  for (const part of parts) {
    const headers = [`Content-Disposition: form-data; ${part.disposition}`];
    if (part.contentType) headers.push(`Content-Type: ${part.contentType}`);
    chunks.push(Buffer.from(`--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(String(part.body)));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/** A fake request: a readable stream plus the one header the parser reads. */
function fakeRequest(body, { boundary = BOUNDARY, contentType } = {}) {
  const stream = Readable.from([body]);
  stream.headers = { "content-type": contentType ?? `multipart/form-data; boundary=${boundary}` };
  return stream;
}

describe("crew multipart parser", () => {
  describe("content type", () => {
    it("reads a bare and a quoted boundary alike", () => {
      expect(parseContentType("multipart/form-data; boundary=abc")).toEqual({ mediaType: "multipart/form-data", boundary: "abc" });
      expect(parseContentType('multipart/form-data; boundary="a b c"')).toEqual({ mediaType: "multipart/form-data", boundary: "a b c" });
    });

    it("refuses a multipart body with no boundary — there is nothing to split on", async () => {
      const request = fakeRequest(Buffer.from("x"), { contentType: "multipart/form-data" });
      await expect(parseMultipartRequest(request)).rejects.toThrow(/boundary/i);
    });

    it("refuses a content type that is not multipart", async () => {
      const request = fakeRequest(Buffer.from("{}"), { contentType: "application/json" });
      await expect(parseMultipartRequest(request)).rejects.toMatchObject({ status: 415 });
    });
  });

  describe("part framing", () => {
    it("keeps a part body byte-exact, including bytes that are not valid UTF-8", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
      const { files } = await parseMultipartRequest(
        fakeRequest(buildBody([{ disposition: 'name="0"; filename="tiny.png"', contentType: "image/png", body: png }])),
      );
      // `toEqual` on Buffers compares bytes. A parser that round-tripped through a
      // string would fail here and pass every ASCII test ever written.
      expect(files.get("0").bytes).toEqual(png);
    });

    it("does not split on a boundary that appears INSIDE a file", async () => {
      // The delimiter is CRLF + "--" + boundary. This body contains the boundary
      // text without the leading CRLF--, so it is content and must survive.
      const sneaky = Buffer.from(`before --${BOUNDARY} after`);
      const { files } = await parseMultipartRequest(
        fakeRequest(buildBody([{ disposition: 'name="0"; filename="s.txt"', contentType: "text/plain", body: sneaky }])),
      );
      expect(files.get("0").bytes).toEqual(sneaky);
    });

    it("tells a file part from a field part by the presence of a filename", async () => {
      const { fields, files } = await parseMultipartRequest(
        fakeRequest(
          buildBody([
            { disposition: 'name="operations"', body: '{"query":"{ __typename }"}' },
            // A filename that is EMPTY still makes it a file — that is how an empty
            // file input reaches the server, and it must be reportable as such.
            { disposition: 'name="0"; filename=""', contentType: "text/plain", body: "" },
          ]),
        ),
      );
      expect(fields.get("operations")).toBe('{"query":"{ __typename }"}');
      expect(files.has("0")).toBe(true);
      expect(files.get("0").filename).toBe("");
    });

    it("refuses a part with no name", async () => {
      await expect(parseMultipartRequest(fakeRequest(buildBody([{ disposition: "", body: "x" }])))).rejects.toThrow(/name/i);
    });

    it("refuses a body whose final delimiter never arrives", async () => {
      const truncated = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue`);
      expect(() => splitParts(truncated, BOUNDARY)).toThrow(MultipartError);
    });
  });

  describe("filenames on the way in", () => {
    it("prefers RFC 5987 filename* over the plain form", () => {
      const parsed = parseDisposition(`form-data; name="0"; filename="naive.pdf"; filename*=UTF-8''na%C3%AFve.pdf`);
      expect(parsed).toEqual({ name: "0", filename: "naïve.pdf" });
    });

    it("falls back to the plain filename when there is no extended one", () => {
      expect(parseDisposition('form-data; name="0"; filename="plain.pdf"').filename).toBe("plain.pdf");
    });
  });

  describe("limits", () => {
    it("stops reading once the total cap is passed, rather than buffering it all", async () => {
      const request = fakeRequest(Buffer.alloc(4096, 0x41));
      await expect(readBody(request, 1024)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", status: 413 });
    });

    it("caps a FIELD separately from a file, because a field is meant to be small", async () => {
      const body = buildBody([{ disposition: 'name="operations"', body: "x".repeat(2048) }]);
      await expect(parseMultipartRequest(fakeRequest(body), { maxFieldBytes: 512 })).rejects.toMatchObject({ code: "FIELD_TOO_LARGE" });
    });

    it("caps the number of parts", async () => {
      const parts = Array.from({ length: 6 }, (_unused, index) => ({ disposition: `name="f${index}"`, body: "x" }));
      await expect(parseMultipartRequest(fakeRequest(buildBody(parts)), { maxParts: 4 })).rejects.toMatchObject({ code: "TOO_MANY_PARTS" });
    });
  });
});

describe("GraphQL multipart request spec", () => {
  const OPERATION = '{"query":"mutation($i:In!){ up(input:$i) }","variables":{"i":{"files":[null,null]}}}';

  function specBody({ operations = OPERATION, map, files = [] }) {
    return buildBody([
      { disposition: 'name="operations"', body: operations },
      { disposition: 'name="map"', body: JSON.stringify(map) },
      ...files.map((file) => ({
        disposition: `name="${file.part}"; filename="${file.filename}"`,
        contentType: file.contentType || "text/plain",
        body: file.body,
      })),
    ]);
  }

  it("substitutes each file into the null hole its map entry names", async () => {
    const body = specBody({
      map: { 0: ["variables.i.files.0"], 1: ["variables.i.files.1"] },
      files: [
        { part: "0", filename: "a.txt", body: "AAA" },
        { part: "1", filename: "b.txt", body: "BB" },
      ],
    });

    const operation = await readGraphQLMultipartRequest(fakeRequest(body));
    const [first, second] = operation.variables.i.files;
    expect(isUpload(first)).toBe(true);
    expect(first.filename).toBe("a.txt");
    expect(first.bytes.toString()).toBe("AAA");
    expect(second.sizeBytes).toBe(2);
  });

  it("lets one file fill two holes, which the spec allows and a client relies on", async () => {
    const body = specBody({
      map: { 0: ["variables.i.files.0", "variables.i.files.1"] },
      files: [{ part: "0", filename: "same.txt", body: "S" }],
    });

    const operation = await readGraphQLMultipartRequest(fakeRequest(body));
    expect(operation.variables.i.files[0]).toBe(operation.variables.i.files[1]);
  });

  it("refuses a map path that is not already null — the arbitrary-write guard", async () => {
    const body = specBody({
      operations: '{"query":"m","variables":{"i":{"staffId":"3","files":[null]}}}',
      map: { 0: ["variables.i.staffId"] },
      files: [{ part: "0", filename: "a.txt", body: "A" }],
    });
    await expect(readGraphQLMultipartRequest(fakeRequest(body))).rejects.toThrow(/null placeholder/);
  });

  it("refuses a map path that does not exist at all", async () => {
    const body = specBody({
      map: { 0: ["variables.i.nope.0"] },
      files: [{ part: "0", filename: "a.txt", body: "A" }],
    });
    await expect(readGraphQLMultipartRequest(fakeRequest(body))).rejects.toThrow(/does not exist/);
  });

  it("refuses a map path that does not start at `variables`", async () => {
    const body = specBody({
      map: { 0: ["query"] },
      files: [{ part: "0", filename: "a.txt", body: "A" }],
    });
    await expect(readGraphQLMultipartRequest(fakeRequest(body))).rejects.toThrow(/must start with "variables"/);
  });

  it("refuses a map entry with no matching part, and a part no entry claims", async () => {
    await expect(readGraphQLMultipartRequest(fakeRequest(specBody({ map: { 0: ["variables.i.files.0"] } })))).rejects.toThrow(
      /does not carry/,
    );

    const stowaway = specBody({
      map: { 0: ["variables.i.files.0"] },
      files: [
        { part: "0", filename: "a.txt", body: "A" },
        { part: "1", filename: "b.txt", body: "B" },
      ],
    });
    await expect(readGraphQLMultipartRequest(fakeRequest(stowaway))).rejects.toThrow(/not referenced by the map/);
  });

  it("refuses a request missing `operations` or `map` entirely", async () => {
    const noMap = buildBody([{ disposition: 'name="operations"', body: OPERATION }]);
    await expect(readGraphQLMultipartRequest(fakeRequest(noMap))).rejects.toThrow(/"map" part/);

    const noOperations = buildBody([{ disposition: 'name="map"', body: "{}" }]);
    await expect(readGraphQLMultipartRequest(fakeRequest(noOperations))).rejects.toThrow(/"operations" part/);
  });

  it("refuses `operations` that is not JSON", async () => {
    const body = buildBody([
      { disposition: 'name="operations"', body: "not json" },
      { disposition: 'name="map"', body: "{}" },
    ]);
    await expect(readGraphQLMultipartRequest(fakeRequest(body))).rejects.toThrow(/not valid JSON/);
  });

  it("brands uploads so a plain object cannot pass for one", () => {
    expect(isUpload(createUpload({ filename: "a", mimeType: "text/plain", bytes: Buffer.from("a") }))).toBe(true);
    expect(isUpload({ filename: "a", mimeType: "text/plain", bytes: Buffer.from("a") })).toBe(false);
    expect(isUpload(null)).toBe(false);
  });

  it("fillHole refuses to walk through a null on the way to the leaf", () => {
    expect(() => fillHole({ variables: { i: null } }, "variables.i.files.0", "x")).toThrow(/does not exist/);
  });
});

describe("Content-Disposition on the way out", () => {
  it("sends both parameters, always", () => {
    expect(contentDispositionAttachment("plain.pdf")).toBe(`attachment; filename="plain.pdf"; filename*=UTF-8''plain.pdf`);
  });

  it("escapes a quote and a backslash so the quoted string cannot end early", () => {
    const header = contentDispositionAttachment('say "hi".pdf');
    expect(header).toContain('filename="say \\"hi\\".pdf"');
    expect(header).toContain("filename*=UTF-8''say%20%22hi%22.pdf");
  });

  it("percent-encodes unicode rather than putting raw bytes in a header", () => {
    expect(encodeRfc5987("naïve.pdf")).toBe("na%C3%AFve.pdf");
  });

  it("falls back to a placeholder when nothing ASCII survives", () => {
    expect(toAsciiFallback("договор")).toBe("document");
    expect(contentDispositionAttachment("договор.pdf")).toContain("filename*=UTF-8''%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80.pdf");
  });
});
