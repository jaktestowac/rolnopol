import { describe, it, expect, beforeAll, afterAll } from "vitest";
const http = require("http");
const path = require("path");

// The exam-center HTTP client wrappers translate every response — and every
// failure — into a uniform { status, body }. The exam-center unit tests inject
// fake clients, so this real wrapper code (503 fallback, non-JSON/empty parsing,
// identity header, path encoding) was otherwise never exercised. We point the
// clients at ONE controllable server and flip its behaviour per test.
const CLIENTS = path.join(__dirname, "..", "..", "external-services", "agri-academy", "exam-center-service", "clients");

let server;
let mode = "json"; // json | html | empty | destroy
let lastReq = null;
let authoringClient;
let certificateClient;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastReq = { url: req.url, headers: req.headers };
    if (mode === "destroy") return res.socket.destroy(); // simulate a dropped connection
    if (mode === "html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<h1>not json</h1>");
    }
    if (mode === "empty") {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Bake the targets + a short timeout BEFORE requiring the clients (config reads
  // env once at require time).
  process.env.AUTHORING_TARGET = base;
  process.env.CERTIFICATE_ISSUER_TARGET = base;
  process.env.AGRI_ACADEMY_HTTP_TIMEOUT_MS = "1500";
  authoringClient = require(path.join(CLIENTS, "authoring-client.js"));
  certificateClient = require(path.join(CLIENTS, "certificate-client.js"));
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

describe("exam-center clients — degradation fallback (503)", () => {
  it("authoring client → 503 AUTHORING_UNAVAILABLE on a dropped connection", async () => {
    mode = "destroy";
    const r = await authoringClient.listPublishedExams();
    expect(r).toEqual({ status: 503, body: { error: "AUTHORING_UNAVAILABLE" } });
  });

  it("certificate client → 503 CERTIFICATE_ISSUER_UNAVAILABLE on a dropped connection", async () => {
    mode = "destroy";
    const r = await certificateClient.verify("AA-2026-000001");
    expect(r).toEqual({ status: 503, body: { error: "CERTIFICATE_ISSUER_UNAVAILABLE" } });
  });
});

describe("exam-center clients — body parsing", () => {
  it("wraps a non-JSON body as { raw }", async () => {
    mode = "html";
    const r = await certificateClient.health();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ raw: "<h1>not json</h1>" });
  });

  it("returns body null for an empty (204) response", async () => {
    mode = "empty";
    const r = await authoringClient.listPublicUnits();
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
  });

  it("passes a JSON body + status straight through", async () => {
    mode = "json";
    const r = await authoringClient.listPublishedExams();
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("exam-center clients — request shaping", () => {
  it("forwards x-academy-user only when a userId is supplied", async () => {
    mode = "json";
    await authoringClient.getMyUnit("owner-42");
    expect(lastReq.headers["x-academy-user"]).toBe("owner-42");
    await authoringClient.listPublicUnits(); // no identity
    expect(lastReq.headers["x-academy-user"]).toBeUndefined();
  });

  it("percent-encodes ids in the request path", async () => {
    mode = "json";
    await certificateClient.verify("AA/2026 01");
    expect(lastReq.url).toBe("/v1/verify/AA%2F2026%2001");
  });
});
