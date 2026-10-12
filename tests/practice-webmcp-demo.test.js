/**
 * WebMCP practice page and its isolated /api/v1/practice/webmcp-demo/* endpoints.
 * Always available: no login, no feature flag, unaffected by the chaos engine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
const fs = require("fs");
const path = require("path");

const app = require("../api/index.js");

const API = "/api/v1/practice/webmcp-demo";
const SESSION_HEADER = "x-practice-session-id";
const PUBLIC_DIR = path.join(__dirname, "../public");

let sessionCounter = 0;
function newSession() {
  sessionCounter += 1;
  return `practice-test-${process.pid}-${sessionCounter}`;
}

function sandbox(sessionId = newSession()) {
  return {
    sessionId,
    get: (route) => request(app).get(`${API}${route}`).set(SESSION_HEADER, sessionId),
    post: (route, body) => request(app).post(`${API}${route}`).set(SESSION_HEADER, sessionId).send(body),
  };
}

describe("WebMCP practice page", () => {
  let originalFlags;

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = res.body.data.flags;
    const allOff = Object.fromEntries(Object.keys(originalFlags).map((key) => [key, false]));
    await request(app).put("/api/v1/feature-flags").send({ flags: allOff }).expect(200);
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  it("is served without login while every feature flag is off", async () => {
    const res = await request(app).get("/practice/webmcp-demo.html").expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("WebMCP demo");
    expect(res.text).toContain("/js/pages/webmcp-demo.js");
    expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  });

  it("redirects the extension-less alias", async () => {
    const res = await request(app).get("/practice/webmcp-demo").expect(302);
    expect(res.headers.location).toBe("/practice/webmcp-demo.html");
  });

  it("answers the API without login while every feature flag is off", async () => {
    const res = await sandbox().get("/state").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.beds.map((bed) => bed.id)).toEqual(["A", "B", "C"]);
    expect(res.body.data.noticeBoard.some((note) => /IGNORE ALL PREVIOUS INSTRUCTIONS/.test(note.text))).toBe(true);
  });
});

describe("WebMCP practice API", () => {
  it("waters a bed and warns when it is waterlogged", async () => {
    const box = sandbox();

    const first = await box.post("/beds/C/water", { liters: 2 }).expect(200);
    expect(first.body.data.bed).toMatchObject({ id: "C", moisturePct: 36, growthPct: 35, ready: false });
    expect(first.body.data.warning).toBeNull();

    const soaked = await box.post("/beds/c/water", { liters: 10 }).expect(200);
    expect(soaked.body.data.bed.moisturePct).toBe(100);
    expect(soaked.body.data.warning).toMatch(/waterlogged/);
  });

  it("validates input", async () => {
    const box = sandbox();

    const badLiters = await box.post("/beds/A/water", { liters: 11 }).expect(400);
    expect(badLiters.body.details.code).toBe("INVALID_LITERS");

    const missingLiters = await box.post("/beds/A/water", {}).expect(400);
    expect(missingLiters.body.details.code).toBe("INVALID_LITERS");

    const unknownBed = await box.post("/beds/Z/water", { liters: 1 }).expect(404);
    expect(unknownBed.body.details.code).toBe("BED_NOT_FOUND");

    const badSession = await request(app).get(`${API}/state`).set(SESSION_HEADER, "bad id!").expect(400);
    expect(badSession.body.details.code).toBe("INVALID_SESSION_ID");
  });

  it("harvests only fully grown beds", async () => {
    const box = sandbox();

    const notReady = await box.post("/beds/B/harvest").expect(409);
    expect(notReady.body.details.code).toBe("BED_NOT_READY");

    const harvested = await box.post("/beds/A/harvest").expect(200);
    expect(harvested.body.data.harvest).toMatchObject({ bedId: "A", crop: "tomato", yieldKg: 12 });
    expect(harvested.body.data.bed).toMatchObject({ growthPct: 0, ready: false });
    expect(harvested.body.data.totalHarvestedKg).toBe(12);

    await box.post("/beds/A/harvest").expect(409);
  });

  it("keeps each session separate", async () => {
    const one = sandbox();
    const two = sandbox();

    await one.post("/beds/A/harvest").expect(200);

    const oneState = await one.get("/state").expect(200);
    const twoState = await two.get("/state").expect(200);
    expect(oneState.body.data.totalHarvestedKg).toBe(12);
    expect(twoState.body.data.totalHarvestedKg).toBe(0);
    expect(twoState.body.data.beds.find((bed) => bed.id === "A").ready).toBe(true);
  });

  it("resets a session", async () => {
    const box = sandbox();
    await box.post("/beds/A/harvest").expect(200);

    const reset = await box.post("/reset").expect(200);

    expect(reset.body.data.totalHarvestedKg).toBe(0);
    expect(reset.body.data.beds.find((bed) => bed.id === "A")).toMatchObject({ growthPct: 100, ready: true });
  });

  it("is not affected by the chaos engine", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: true, probability: 1, statusCodes: [503], message: "Forced chaos error" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: { methods: ["GET", "POST"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 100 },
        },
      })
      .expect(200);

    try {
      await request(app).get("/api/v1/about").expect(503);
      await sandbox().get("/state").expect(200);
    } finally {
      await request(app).post("/api/v1/chaos-engine/reset").expect(200);
    }
  });
});

describe("Practice catalog", () => {
  it("serves /practice/ with the site header and footer, without login", async () => {
    const res = await request(app).get("/practice/").expect(200);

    expect(res.text).toContain("Practice pages");
    expect(res.text).toContain('id="header-component"');
    expect(res.text).toContain('id="footer-component"');
    expect(res.text).toContain("/js/pages/practice-catalog.js");
  });

  it("lists practice pages that all exist", async () => {
    const res = await request(app).get("/api/v1/practice/catalog").expect(200);
    const { pages, difficulties } = res.body.data;

    expect(pages.map((page) => page.id)).toEqual(expect.arrayContaining(["webmcp-demo", "webmcp-seed-shop"]));
    expect(difficulties).toEqual(["beginner", "intermediate", "advanced"]);
    for (const page of pages) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, page.path)), page.path).toBe(true);
      await request(app).get(page.path).expect(200);
    }
  });

  it("is not linked from outside the practice pages", () => {
    const linking = listFiles(PUBLIC_DIR)
      .filter((file) => /\.(html|js)$/.test(file))
      .filter((file) => !file.includes(`${path.sep}practice${path.sep}`) && !file.endsWith("practice-catalog.js") && !file.endsWith("webmcp-demo.js"))
      .filter((file) => /["'`]\/practice\//.test(fs.readFileSync(file, "utf8")));

    expect(linking).toEqual([]);
  });
});

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

describe("WebMCP practice isolation", () => {
  function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    });
  }

  it("is not linked from any other page or script", () => {
    const own = new Set(
      [
        "practice/webmcp-demo.html",
        "js/pages/webmcp-demo.js",
        "css/pages/webmcp-demo.css",
        "js/pages/webmcp-explainer.js",
        "css/pages/webmcp-explainer.css",
      ].map((file) => path.join(PUBLIC_DIR, file)),
    );
    const linking = listFiles(PUBLIC_DIR)
      .filter((file) => /\.(html|js|css|json|xml|txt)$/.test(file) && !own.has(file))
      .filter((file) => !file.includes(`${path.sep}schema${path.sep}`))
      .filter((file) => fs.readFileSync(file, "utf8").includes("webmcp-demo"));

    expect(linking).toEqual([]);
  });

  it("keeps its state away from the databases, flags and auth", () => {
    const sources = ["../services/practice/webmcp-demo.service.js", "../controllers/practice.controller.js", "../routes/v1/practice.route.js"].map(
      (file) => fs.readFileSync(path.join(__dirname, file), "utf8"),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/database-manager|feature-flag|auth\.middleware|rate-limit/);
    }
  });
});
