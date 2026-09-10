import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const fs = require("fs");
const path = require("path");

// THE non-impact contract (PRD §12). The REST regression snapshot below is the
// single most important test in the module: whatever Crew Office grows into, the
// rest of Rolnopol must answer identically with `crewOfficeEnabled` on and off.
//
// Bodies are compared by SHAPE, not bytes, because `formatResponseBody` stamps a
// fresh `timestamp` into every payload and several endpoints report live counters.
// Shape comparison still catches the drift that matters: a changed key, a changed
// type, a field appearing or vanishing.
const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");

const FLAG = "crewOfficeEnabled";
const DATA_DIR = path.join(__dirname, "..", "data");

// ~33 representative endpoints across health, public reads, and owned resources.
const PUBLIC_ENDPOINTS = [
  "/api/v1/health",
  "/api/v1/health/databases",
  "/api/v1/health/memory",
  "/api/v1/healthcheck",
  "/api/v1/ping",
  "/api/v1/about",
  "/api/v1/statistics",
  "/api/v1/feature-flags",
  "/api/v1/map",
  "/api/v1/map/districts",
  "/api/v1/map/fieldsmap",
  "/api/v1/notifications/count",
  "/api/v1/services/status",
  "/api/v1/alerts",
  "/api/v1/alerts/history",
  "/api/v1/alerts/upcoming",
  "/api/v1/animals/types",
  "/api/v1/blogs",
  "/api/v1/documentation",
  "/api/v1/weather",
  "/api/v1/weather/forecast",
  "/api/v1/weather/regions",
  "/api/v1/tasks/statuses",
  "/api/v1/tasks/labels",
];

const AUTHED_ENDPOINTS = [
  "/api/v1/staff",
  "/api/v1/fields",
  "/api/v1/animals",
  "/api/v1/users/profile",
  "/api/v1/users/statistics",
  "/api/v1/financial/account",
  "/api/v1/financial/stats",
  "/api/v1/tasks",
  "/api/v1/notifications",
];

// Headers that legitimately differ between two identical requests. Note what is
// NOT here: `ratelimit-limit` and `ratelimit-policy` stay in the comparison,
// because those are the limiter *config* — and rule 2's promise is that Crew
// Office adds its own limiter instance without touching the shared one. Only the
// per-request counters are excluded.
const VOLATILE_HEADERS = new Set([
  "date",
  "etag",
  "content-length",
  "connection",
  "keep-alive",
  "x-response-time",
  "x-rolnopol-clue",
  "ratelimit-remaining",
  "ratelimit-reset",
]);

// Payload fields that carry wall-clock or live-counter values.
const VOLATILE_FIELDS = new Set(["timestamp", "updatedAt"]);

function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? ["array", "empty"] : ["array", shapeOf(value[0])];
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_FIELDS.has(key)) continue;
      out[key] = shapeOf(value[key]);
    }
    return out;
  }
  return typeof value;
}

function stableHeaders(headers) {
  const out = {};
  for (const key of Object.keys(headers).sort()) {
    if (VOLATILE_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase().startsWith("x-chaos-")) continue;
    out[key.toLowerCase()] = headers[key];
  }
  return out;
}

async function sweep(token) {
  const snapshot = [];
  for (const url of PUBLIC_ENDPOINTS) {
    const res = await request(app).get(url);
    snapshot.push({ url, status: res.status, headers: stableHeaders(res.headers), body: shapeOf(res.body) });
  }
  for (const url of AUTHED_ENDPOINTS) {
    const res = await request(app).get(url).set("Cookie", `rolnopolToken=${token}`);
    snapshot.push({ url, status: res.status, headers: stableHeaders(res.headers), body: shapeOf(res.body) });
  }
  return snapshot;
}

async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}
async function setEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}

function crewStoreFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((name) => /^crew-.*\.json$/.test(name));
}

describe("Crew Office — the non-impact contract", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenHelpers.generateToken("crew-isolation-user");
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  describe("rule 5 — REST regression snapshot", () => {
    it("answers identically across ~33 endpoints with the flag off and on", async () => {
      await setEnabled(false);
      const off = await sweep(token);

      await setEnabled(true);
      const on = await sweep(token);

      // Guard against the test degrading into "33 identical 404s" if a path is
      // renamed upstream — the sweep has to actually be exercising the app.
      const answered = off.filter((entry) => entry.status < 400).length;
      expect(answered).toBeGreaterThanOrEqual(15);

      expect(on).toEqual(off);
    });
  });

  describe("rule 1 — flag off means no filesystem footprint", () => {
    it("creates no data/crew-*.json store after a full request sweep with the flag off", async () => {
      await setEnabled(false);
      // Snapshot rather than demand an empty data/ directory: once the module has
      // ever been enabled its stores exist legitimately, and the rule being tested
      // is that a disabled module creates NOTHING NEW — not that the files were
      // never created at all.
      const before = crewStoreFiles();

      // Everything the module would ever be asked for, while it does not exist.
      const paths = [
        "/crew",
        "/crew.html",
        "/crew-member.html",
        "/crew-work.html",
        "/crew-leave.html",
        "/crew-tools.html",
        "/crew-explorer.html",
        "/api/v1/crew/health",
        "/api/graphql/crew",
      ];
      for (const url of paths) {
        await request(app).get(url).set("Cookie", `rolnopolToken=${token}`).expect(404);
      }
      await request(app).post("/api/graphql/crew").send({ query: "{ crew { staffId } }" }).expect(404);

      expect(crewStoreFiles()).toEqual(before);
    });

    it("404s the graph endpoint itself with the flag off, for POST and GET alike", async () => {
      await setEnabled(false);
      await request(app)
        .post("/api/graphql/crew")
        .set("Content-Type", "application/json")
        .set("Cookie", `rolnopolToken=${token}`)
        .send({ query: "{ crewInfo { pillars } }" })
        .expect(404);
      await request(app).get("/api/graphql/crew").set("Cookie", `rolnopolToken=${token}`).expect(404);
    });

    it("keeps crew stores out of the base-state seed and the debug restore (§6.6)", async () => {
      const baseStatePath = path.join(DATA_DIR, "database-base-state.json");
      if (!fs.existsSync(baseStatePath)) return;
      const baseState = JSON.parse(fs.readFileSync(baseStatePath, "utf8"));
      const crewKeys = Object.keys(baseState).filter((key) => key.toLowerCase().startsWith("crew"));
      expect(crewKeys).toEqual([]);
    });
  });

  describe("rule 6 — defensive load", () => {
    it("requires the crew route inside try/catch and falls back to an empty router", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "routes", "v1", "index.js"), "utf8");
      // The pattern every optional subsystem in this file follows: the app must
      // boot with the module broken.
      const block = source.match(/try\s*\{[\s\S]{0,200}?require\(["']\.\/crew\.route["']\)[\s\S]{0,500}?catch[\s\S]{0,400}?\n\}/);
      expect(block, "crew.route must be required defensively").not.toBeNull();
      // The fallback has to be a real empty router, not a rethrow or a bare log.
      expect(block[0]).toMatch(/crewRoute\s*=\s*express\.Router\(\)/);
      expect(source).toMatch(/router\.use\(["']\/["'],\s*crewRoute\)/);
    });
  });

  describe("rule 7 — setup unchanged", () => {
    it("adds no runtime dependency beyond the documented set", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
      // The pre-existing 10, plus exactly one: `graphql` (§7.2). This list is the
      // tripwire that stops a native or peer-service dependency arriving unreviewed.
      const expected = [
        "@grpc/grpc-js",
        "@grpc/proto-loader",
        "cookie-parser",
        "dotenv",
        "express",
        "express-rate-limit",
        "jsonwebtoken",
        "otpauth",
        "qrcode",
        "ws",
        "graphql",
      ];
      expect(Object.keys(pkg.dependencies).sort()).toEqual(expected.sort());
    });

    it("keeps graphql on 16.x — pure JS, zero transitive deps, real CommonJS", () => {
      // Not pedantry: 17.x was briefly installed here and it BROKE custom-scalar
      // validation silently (parseValue is no longer consulted during variable
      // coercion), while `require("graphql")` resolved to an .mjs entry that only
      // loads on Node >= 22. Both are exactly what §7.2's "verify the module format
      // before bumping" caveat exists for, so the major is pinned by test.
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
      expect(pkg.dependencies.graphql).toMatch(/^\^?16\./);

      const installed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "node_modules", "graphql", "package.json"), "utf8"));
      expect(installed.version).toMatch(/^16\./);
      // The three properties the dependency decision rests on.
      expect(installed.dependencies || {}).toEqual({});
      expect(installed.type).toBeUndefined();
      expect(installed.license).toBe("MIT");
      // And require() must land on CommonJS, not on an ESM entry point.
      expect(require.resolve("graphql").endsWith(".js")).toBe(true);
      expect(require.resolve("graphql").endsWith(".mjs")).toBe(false);
    });

    it("still validates a custom scalar through the VARIABLE path — the 17.x tripwire", async () => {
      // This is the assertion that caught the silent bump. If a future upgrade
      // stops honouring parseValue during variable coercion, this fails loudly
      // instead of the module quietly accepting 30 February.
      const { assembleCrewSchema } = require("../services/crew/registry");
      const { schema } = assembleCrewSchema();
      const { coerceInputValue } = require("graphql");
      const errors = [];
      coerceInputValue("2026-02-30", schema.getType("Date"), (_path, _value, error) => errors.push(error.message));
      expect(errors.join(" ")).toMatch(/not a real calendar date/);
    });
  });

  describe("rule 2 — no global middleware", () => {
    it("registers nothing on the root app: existing endpoint headers are unchanged with the flag on", async () => {
      await setEnabled(false);
      const off = await request(app).get("/api/v1/health");
      await setEnabled(true);
      const on = await request(app).get("/api/v1/health");
      expect(stableHeaders(on.headers)).toEqual(stableHeaders(off.headers));
    });
  });

  describe("§12.2 — the forbidden-call list is absent from the module", () => {
    it("no crew source file mentions cascadeDelete, assignStaffToField or removeAssignment", () => {
      const FORBIDDEN = ["cascadeDelete", "assignStaffToField", "removeAssignment"];
      const roots = [
        path.join(__dirname, "..", "services", "crew"),
        path.join(__dirname, "..", "services", "graphql"),
        path.join(__dirname, "..", "routes", "v1", "crew.route.js"),
        path.join(__dirname, "..", "controllers", "crew-graphql.controller.js"),
      ];
      const violations = [];
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const file of jsFiles(root)) {
          const src = fs.readFileSync(file, "utf8");
          for (const call of FORBIDDEN) {
            // A comment saying it is never called is fine; a call is not.
            const codeLines = src.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
            if (codeLines.some((line) => line.includes(call))) {
              violations.push(`${path.relative(path.join(__dirname, ".."), file)} → ${call}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });
});

function jsFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith(".js") ? [target] : [];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}
