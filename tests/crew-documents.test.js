import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

/**
 * Crew Office — personnel files (#100).
 *
 * The whole chain, through the real endpoint: a `multipart/form-data` body framed
 * per the GraphQL multipart request specification, the graph's own validation
 * matrix, the derived scan state, and the download route's headers and bytes.
 *
 * Nothing here mocks the parser. The body is assembled byte by byte in the harness
 * so that a change which accepted the WRONG framing would fail these tests — which
 * is the only way an upload contract can actually be pinned.
 */
const {
  app,
  setCrewEnabled,
  setFlags,
  getFlags,
  restoreFlags,
  resetCrewStores,
  registerAndLogin,
  graph,
  graphData,
  graphUpload,
  uploadDocuments,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
} = require("./helpers/crew-harness");

const PDF = { contentType: "application/pdf", body: Buffer.from("%PDF-1.4 a contract\n") };
const PNG = { contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) };

const file = (filename, spec = PDF, body) => ({ filename, contentType: spec.contentType, body: body || spec.body });

describe("Crew Office — personnel files", () => {
  let originalFlags;
  let token;
  let strangerToken;
  let staffId;

  // Two accounts for the whole suite rather than one per test. Isolation comes from
  // `resetCrewStores` in `beforeEach`, not from a fresh identity, so registering
  // nineteen users would buy nothing and cost nineteen round trips.
  //
  // Prefixes stay short: the harness builds `displayedName` as `<prefix>-user`, and
  // registration caps that at 20 characters.
  beforeAll(async () => {
    originalFlags = await getFlags();
    await setCrewEnabled(true);
    token = (await registerAndLogin("crewdocs")).token;
    strangerToken = (await registerAndLogin("crewother")).token;
  });

  afterAll(async () => {
    await resetCrewStores();
    await restoreFlags(originalFlags);
  });

  beforeEach(async () => {
    await resetCrewStores();
    const hired = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, name: "Dana", surname: "Fields" } },
      token,
    });
    staffId = hired.hireCrewMember.crewMember.staffId;
  });

  // ── The spec itself ─────────────────────────────────────────────────────────

  it("uploads through the GraphQL multipart request spec and files the document", async () => {
    const res = await uploadDocuments({
      token,
      staffId,
      kind: "CONTRACT",
      files: [file("contract 2026.pdf")],
    });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.rejected).toEqual([]);
    expect(payload.accepted).toHaveLength(1);

    const [document] = payload.accepted;
    expect(document).toMatchObject({
      filename: "contract 2026.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.body.length,
      kind: "CONTRACT",
      status: "PENDING", // freshly uploaded — the scan has not finished
    });
    expect(document.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(document.downloadPath).toBe(`/api/v1/crew/documents/${document.id}`);
    expect(payload.folder.totalCount).toBe(1);
    expect(payload.folder.totalBytes).toBe(PDF.body.length);
  });

  it("attaches the folder to the member, so one query answers the whole personnel file", async () => {
    await uploadDocuments({ token, staffId, kind: "LICENCE", files: [file("licence.png", PNG)] });

    const data = await graphData({
      query: `query($id: ID!) { crewMember(staffId: $id) { staffId documents { totalCount totalBytes items { filename kind } } } }`,
      variables: { id: staffId },
      token,
    });

    expect(data.crewMember.documents.totalCount).toBe(1);
    expect(data.crewMember.documents.items[0]).toEqual({ filename: "licence.png", kind: "LICENCE" });
  });

  it("fills several holes from several parts, in one operation", async () => {
    const res = await uploadDocuments({
      token,
      staffId,
      files: [file("a.pdf"), file("b.png", PNG), file("c.txt", { contentType: "text/plain", body: Buffer.from("notes") })],
    });

    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.accepted.map((d) => d.filename)).toEqual(["a.pdf", "b.png", "c.txt"]);
    expect(payload.folder.totalCount).toBe(3);
    // Ids are handed out once each — the counter is inside the store lock.
    expect(new Set(payload.accepted.map((d) => d.id)).size).toBe(3);
  });

  // ── Partial success ─────────────────────────────────────────────────────────

  it("accepts the good files and reports the bad ones, rather than failing the batch", async () => {
    const res = await uploadDocuments({
      token,
      staffId,
      files: [
        file("good.pdf"),
        file("script.exe", { contentType: "application/octet-stream", body: Buffer.from("MZ") }),
        file("lying.pdf", { contentType: "text/html", body: Buffer.from("<script>") }),
        file("empty.txt", { contentType: "text/plain", body: Buffer.alloc(0) }),
        file("also-good.png", PNG),
      ],
    });

    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.accepted.map((d) => d.filename)).toEqual(["good.pdf", "also-good.png"]);
    expect(payload.rejected.map((r) => [r.filename, r.code])).toEqual([
      ["script.exe", "UNSUPPORTED_EXTENSION"],
      ["lying.pdf", "TYPE_MISMATCH"], // extension says PDF, the type says HTML
      ["empty.txt", "EMPTY_FILE"],
    ]);
    // The half that worked is really filed: partial success is success for those.
    expect(payload.folder.totalCount).toBe(2);
  });

  it("refuses the surplus files past the batch cap and keeps the rest", async () => {
    const files = Array.from({ length: 7 }, (_unused, index) => file(`page-${index + 1}.pdf`));
    const res = await uploadDocuments({ token, staffId, files });

    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.accepted).toHaveLength(5);
    expect(payload.rejected.map((r) => r.code)).toEqual(["TOO_MANY_FILES", "TOO_MANY_FILES"]);
  });

  it("rejects a file over the per-file cap without refusing its siblings", async () => {
    const res = await uploadDocuments({
      token,
      staffId,
      files: [file("small.pdf"), file("huge.pdf", { contentType: "application/pdf", body: Buffer.alloc(1024 * 1024 + 1, 0x41) })],
    });

    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.accepted.map((d) => d.filename)).toEqual(["small.pdf"]);
    expect(payload.rejected[0]).toMatchObject({ filename: "huge.pdf", code: "FILE_TOO_LARGE" });
  });

  it("strips path segments from a filename instead of trusting it", async () => {
    const res = await uploadDocuments({ token, staffId, files: [file("../../../etc/passwd.pdf")] });
    const payload = res.body.data.uploadCrewDocuments;
    expect(payload.accepted[0].filename).toBe("passwd.pdf");
  });

  // ── The scan ────────────────────────────────────────────────────────────────

  it("holds a document PENDING until the scan window closes, then makes it AVAILABLE", async () => {
    const upload = await uploadDocuments({ token, staffId, files: [file("slow.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];
    expect(document.status).toBe("PENDING");

    // Downloading early is a 409, not a 404: the document exists, it is just not
    // ready — and the response says when it will be.
    const early = await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`).expect(409);
    expect(early.body?.details?.status).toBe("PENDING");
    expect(early.body?.details?.scanCompletesAt).toBe(document.scanCompletesAt);

    // Poll rather than sleep once: the state is derived from the clock, so it flips
    // on its own and the assertion is "eventually", not "after exactly 3s".
    const readyAt = Date.parse(document.scanCompletesAt);
    let status = "PENDING";
    for (let attempt = 0; attempt < 40 && status === "PENDING"; attempt += 1) {
      const data = await graphData({ query: `query($id: ID!){ crewDocument(id: $id){ status } }`, variables: { id: document.id }, token });
      status = data.crewDocument.status;
      if (status === "PENDING") await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(status).toBe("AVAILABLE");
    expect(Date.now()).toBeGreaterThanOrEqual(readyAt);
  }, 20000);

  it("keeps a flagged document forever, and never serves it", async () => {
    const upload = await uploadDocuments({
      token,
      staffId,
      files: [file("eicar-sample.txt", { contentType: "text/plain", body: Buffer.from("x") })],
    });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    let status = "PENDING";
    for (let attempt = 0; attempt < 40 && status === "PENDING"; attempt += 1) {
      const data = await graphData({
        query: `query($id: ID!){ crewDocument(id: $id){ status scanDetail } }`,
        variables: { id: document.id },
        token,
      });
      status = data.crewDocument.status;
      if (status === "PENDING") await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(status).toBe("REJECTED");
    // 410, not 404: it existed, it still exists, and it will never be downloadable.
    await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`).expect(410);
    // And it is still in the folder — this module deletes nothing.
    const data = await graphData({
      query: `query($id: ID!){ crewMember(staffId: $id){ documents { totalCount } } }`,
      variables: { id: staffId },
      token,
    });
    expect(data.crewMember.documents.totalCount).toBe(1);
  }, 20000);

  // ── Download ────────────────────────────────────────────────────────────────

  it("serves the exact bytes back, with a filename a browser can read", async () => {
    const bytes = Buffer.from('%PDF-1.4 naïve, with a "quote" and a ; semicolon\n');
    const upload = await uploadDocuments({
      token,
      staffId,
      files: [file('naïve "final"; v2.pdf', { contentType: "application/pdf", body: bytes })],
    });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      const res = await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`);
      if (res.status === 200) {
        ready = true;
        expect(Buffer.from(res.body)).toEqual(bytes); // byte-exact, not "close enough"
        expect(res.headers["content-type"]).toContain("application/pdf");
        expect(res.headers["content-length"]).toBe(String(bytes.length));
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers.etag).toBe(`"${document.checksum}"`);

        // RFC 6266: an escaped ASCII fallback AND the real name, percent-encoded.
        const disposition = res.headers["content-disposition"];
        expect(disposition).toContain('filename="nave \\"final\\"; v2.pdf"');
        expect(disposition).toContain("filename*=UTF-8''na%C3%AFve%20%22final%22%3B%20v2.pdf");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(ready).toBe(true);
  }, 20000);

  // ── Preview ─────────────────────────────────────────────────────────────────

  it("serves the same bytes inline for a preview, with a policy that stops them doing anything", async () => {
    const bytes = Buffer.from("a,b,c\n1,2,3\n");
    const upload = await uploadDocuments({
      token,
      staffId,
      files: [file("rota.csv", { contentType: "text/csv", body: bytes })],
    });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];
    expect(document.previewable).toBe(true);
    expect(document.previewPath).toBe(`/api/v1/crew/documents/${document.id}?disposition=inline`);

    let res;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      res = await request(app).get(document.previewPath).set("Cookie", `rolnopolToken=${token}`);
      if (res.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(res.status).toBe(200);
    // `res.text` rather than `res.body`: supertest parses a text/* response into a
    // string and leaves `body` an empty object. The assertion is still byte-for-byte
    // — it is the same bytes served, not a rendering of them.
    expect(res.text).toBe(bytes.toString());
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    // Still named, so "save as" from the viewer keeps the filename rather than the id.
    expect(res.headers["content-disposition"]).toContain('filename="rota.csv"');
    // nosniff is what makes text/* safe to render at all; the CSP is the second lock.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
  }, 20000);

  it("still attaches by default — inline is opt-in, and carries no CSP when not used", async () => {
    const upload = await uploadDocuments({ token, staffId, files: [file("plain.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    let res;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      res = await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`);
      if (res.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  }, 20000);

  it("downgrades an inline request for a type that must not be rendered, rather than refusing it", async () => {
    // Nothing on the upload allow-list is outside the preview list today, so the
    // downgrade is asserted through the route's own rule: an unknown disposition
    // and a non-previewable type both come back as an attachment. This is the
    // guard that matters the day someone widens the upload list — an .svg would
    // become uploadable and must still refuse to render in this origin.
    const upload = await uploadDocuments({
      token,
      staffId,
      files: [file("notes.txt", { contentType: "text/plain", body: Buffer.from("hi") })],
    });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    let res;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      res = await request(app).get(`${document.downloadPath}?disposition=sideways`).set("Cookie", `rolnopolToken=${token}`);
      if (res.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);

    const { isPreviewable } = require("../services/crew/pillars/documents/policy");
    expect(isPreviewable("image/svg+xml")).toBe(false);
    expect(isPreviewable("text/html")).toBe(false);
    expect(isPreviewable("text/csv")).toBe(true);
  }, 20000);

  it("applies the same status and ownership rules to a preview as to a download", async () => {
    const upload = await uploadDocuments({ token, staffId, files: [file("fresh.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    // Pending: 409 on the preview path too — one route, one set of rules.
    await request(app).get(document.previewPath).set("Cookie", `rolnopolToken=${token}`).expect(409);
    // Somebody else's: 404, no hint that it exists.
    await request(app).get(document.previewPath).set("Cookie", `rolnopolToken=${strangerToken}`).expect(404);
  });

  it("reports a record whose bytes are gone as MISSING, rather than as a download that 500s", async () => {
    // The state is reachable in real use: the record and the blob are written
    // separately on purpose (decision 3 in service.js), and the blob directory is
    // the half that a cleanup, a restore or a stray `rm` takes out. Before this was
    // a status, the only way to discover it was to click Download and get a 500.
    const fs = require("fs");
    const { blobPathFor } = require("../services/crew/pillars/documents/store");

    const upload = await uploadDocuments({ token, staffId, files: [file("vanishing.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    // Wait out the scan, so PENDING cannot be what we end up asserting.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const data = await graphData({ query: `query($id: ID!){ crewDocument(id: $id){ status } }`, variables: { id: document.id }, token });
      if (data.crewDocument.status === "AVAILABLE") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    fs.rmSync(blobPathFor(document.id));

    const data = await graphData({
      query: `query($id: ID!){ crewDocument(id: $id){ status filename } crewMember(staffId: "${staffId}"){ documents { totalCount } } }`,
      variables: { id: document.id },
      token,
    });
    // The row is still there — nothing is ever deleted — and it says what is wrong.
    expect(data.crewDocument.status).toBe("MISSING");
    expect(data.crewDocument.filename).toBe("vanishing.pdf");
    expect(data.crewMember.documents.totalCount).toBe(1);

    // The route still answers 500, because a record without its bytes IS a server
    // inconsistency — but the page no longer offers the button that reaches it.
    const res = await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`).expect(500);
    expect(res.body.error).toContain("missing");
  }, 20000);

  it("does not serve one caller's document to another, and does not admit it exists", async () => {
    const upload = await uploadDocuments({ token, staffId, files: [file("private.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${strangerToken}`).expect(404);

    const data = await graphData({
      query: `query($id: ID!){ crewDocument(id: $id){ id } }`,
      variables: { id: document.id },
      token: strangerToken,
    });
    expect(data.crewDocument).toBeNull();
  });

  it("requires the flag and a session for the download, in that order", async () => {
    const upload = await uploadDocuments({ token, staffId, files: [file("gated.pdf")] });
    const document = upload.body.data.uploadCrewDocuments.accepted[0];

    await request(app).get(document.downloadPath).expect(401);

    await setCrewEnabled(false);
    // Flag before auth: an authenticated caller must not be able to tell the module
    // apart from one that was never built.
    await request(app).get(document.downloadPath).set("Cookie", `rolnopolToken=${token}`).expect(404);
    await setCrewEnabled(true);
  });

  // ── The transport's own rules ───────────────────────────────────────────────

  it("refuses a multipart request that omits the anti-CSRF header", async () => {
    const res = await graphUpload({
      query: `mutation Upload($input: UploadCrewDocumentsInput!) { uploadCrewDocuments(input: $input) { staffId } }`,
      variables: { input: { staffId, files: [null] } },
      map: { 0: ["variables.input.files.0"] },
      files: [{ part: "0", ...file("x.pdf") }],
      token,
      uploadHeader: false,
    });

    expect(res.status).toBe(415);
    expect(res.body.errors[0].extensions.code).toBe("UPLOAD_HEADER_REQUIRED");
  });

  it("refuses a map path that does not point at a null placeholder", async () => {
    const res = await graphUpload({
      query: `mutation Upload($input: UploadCrewDocumentsInput!) { uploadCrewDocuments(input: $input) { staffId } }`,
      // The hole is where `files.0` is; the map aims at `staffId` instead, which is
      // the arbitrary-write attempt the spec layer exists to refuse.
      variables: { input: { staffId, files: [null] } },
      map: { 0: ["variables.input.staffId"] },
      files: [{ part: "0", ...file("x.pdf") }],
      token,
    });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].extensions.code).toBe("MULTIPART_SPEC_VIOLATION");
    expect(res.body.errors[0].message).toContain("null placeholder");
  });

  it("refuses a file part nothing in the map claims", async () => {
    const res = await graphUpload({
      query: `mutation Upload($input: UploadCrewDocumentsInput!) { uploadCrewDocuments(input: $input) { staffId } }`,
      variables: { input: { staffId, files: [null] } },
      map: { 0: ["variables.input.files.0"] },
      files: [
        { part: "0", ...file("claimed.pdf") },
        { part: "1", ...file("stowaway.pdf") },
      ],
      token,
    });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].extensions.code).toBe("MULTIPART_SPEC_VIOLATION");
    expect(res.body.errors[0].message).toContain("not referenced by the map");
  });

  it("refuses an Upload that did not come from a file part", async () => {
    // The forgery attempt: a plain JSON request handing the resolver something
    // shaped like a file. The scalar is the only thing standing between that and a
    // byte sink, so it is asserted directly.
    const res = await graph({
      query: `mutation Upload($input: UploadCrewDocumentsInput!) { uploadCrewDocuments(input: $input) { staffId } }`,
      variables: { input: { staffId, files: [{ filename: "forged.pdf", bytes: "AAAA" }] } },
      token,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.errors)).toContain("multipart");
  });

  it("cannot be reached at all with the module disabled", async () => {
    await setCrewEnabled(false);
    const res = await uploadDocuments({ token, staffId, files: [file("nope.pdf")] });
    expect(res.status).toBe(404);
    await setCrewEnabled(true);
  });

  it("reports an unknown or unowned member as MEMBER_NOT_FOUND, refusing the whole batch", async () => {
    const res = await uploadDocuments({ token, staffId: "999999", files: [file("orphan.pdf")] });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].extensions.code).toBe("MEMBER_NOT_FOUND");
    // `uploadCrewDocuments` is non-nullable, so the error propagates to the root and
    // `data` is null outright — not `{ uploadCrewDocuments: null }`. That is the
    // schema's nullability doing what it was written to do, and it is worth pinning:
    // a client reading `data.uploadCrewDocuments` would throw rather than read false.
    expect(res.body.data).toBeNull();
  });

  it("keeps the module's other flag combinations out of it", async () => {
    // Documents are part of Crew Office and have no flag of their own; the pillar
    // list is the assertion that it assembled rather than being dropped.
    await setFlags({ crewOfficeEnabled: true });
    const res = await graph({ query: `{ crewInfo { pillars } }`, token });
    expect(res.body.data.crewInfo.pillars).toContain("documents");
    expect(res.body.extensions.pillars).toContain("documents");
  });
});
