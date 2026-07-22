import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DBs + ephemeral bank port BEFORE requiring the services.
const QB_DB = path.join(os.tmpdir(), `aa-auth-qb-${process.pid}.json`);
const AUTH_DB = path.join(os.tmpdir(), `aa-authoring-${process.pid}.json`);
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.AUTHORING_DB_PATH = AUTH_DB;
process.env.AGRI_ACADEMY_LOG = "silent";

const ROOT = path.join(__dirname, "..", "..", "external-services", "agri-academy");
const QB = path.join(ROOT, "question-bank-service");
const AS = path.join(ROOT, "authoring-service");
const { validateExamInput } = require(path.join(AS, "server", "index.js"));

let bankServer;
let app;

const OWNER = "owner-a";
const OTHER = "owner-b";
const as = (req, u = OWNER) => req.set("x-academy-user", u);

beforeAll(async () => {
  const { start } = require(path.join(QB, "server", "index.js"));
  const started = await start();
  bankServer = started.server;
  process.env.QUESTION_BANK_GRPC_TARGET = `localhost:${started.port}`;

  const db = require(path.join(AS, "server", "db.js"));
  await db.init();
  app = require(path.join(AS, "server", "index.js")).buildApp();
});

// A build of the app whose question-bank client always fails, to drive the
// QUESTION_BANK_UNAVAILABLE (503) degradation branches.
function downBankApp() {
  const down = async () => {
    throw Object.assign(new Error("bank down"), { code: 14 });
  };
  return require(path.join(AS, "server", "index.js")).buildApp({
    questionBank: { list: down, upsert: down, remove: down },
  });
}

afterAll(() => {
  if (bankServer) bankServer.forceShutdown();
  for (const f of [QB_DB, AUTH_DB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("authoring — public surfaces (seeded)", () => {
  it("lists the demo unit in the public directory with an exam count", async () => {
    const res = await request(app).get("/v1/public/units").expect(200);
    const demo = res.body.units.find((u) => u.unitId === "unit-demo");
    expect(demo).toBeTruthy();
    expect(demo.examCount).toBe(2);
  });
  it("serves the demo unit's public profile with exam cards", async () => {
    const res = await request(app).get("/v1/public/units/unit-demo").expect(200);
    expect(res.body.name).toMatch(/Demo/);
    expect(res.body.exams.map((e) => e.id).sort()).toEqual(["pesticide-basics", "tractor-safety"]);
  });
  it("exposes the published read surface for the exam center", async () => {
    const res = await request(app).get("/v1/published/exams").expect(200);
    expect(res.body.exams.length).toBeGreaterThanOrEqual(2);
    const one = await request(app).get("/v1/published/exams/pesticide-basics").expect(200);
    expect(one.body.questionCount).toBe(3);
  });
});

describe("authoring — units", () => {
  it("requires identity", async () => {
    await request(app).get("/v1/units/me").expect(401);
    await request(app).post("/v1/units").send({ name: "x" }).expect(401);
  });
  it("404s /units/me before registration", async () => {
    await as(request(app).get("/v1/units/me"), "nobody").expect(404);
  });
  it("registers a unit (with description) and is idempotent per user", async () => {
    const first = await as(request(app).post("/v1/units"))
      .send({ name: "Acme Cert", description: "We certify", contactEmail: "a@b.c" })
      .expect(201);
    expect(first.body.unitId).toBeTruthy();
    expect(first.body.description).toBe("We certify");
    const again = await as(request(app).post("/v1/units")).send({ name: "Acme Cert 2" }).expect(200);
    expect(again.body.unitId).toBe(first.body.unitId);
  });
  it("rejects a unit with no name", async () => {
    await as(request(app).post("/v1/units"), "no-name-user").send({ description: "x" }).expect(400);
  });
  it("edits the caller's unit", async () => {
    const res = await as(request(app).patch("/v1/units/me")).send({ description: "Updated blurb" }).expect(200);
    expect(res.body.description).toBe("Updated blurb");
  });
});

describe("authoring — unit branding (tags / color / icon)", () => {
  const BRAND = "brand-owner";
  const asBrand = (req) => req.set("x-academy-user", BRAND);

  it("exposes the predefined branding presets", async () => {
    const res = await request(app).get("/v1/unit-presets").expect(200);
    expect(Array.isArray(res.body.icons)).toBe(true);
    expect(res.body.icons).toContain("tractor");
    expect(res.body.palette.length).toBeGreaterThan(0);
    expect(res.body.defaultIcon).toBeTruthy();
  });

  it("registers a unit with tags, colour, and a predefined icon (dedupes/caps tags)", async () => {
    const res = await asBrand(request(app).post("/v1/units"))
      .send({
        name: "Branded Unit",
        tags: ["Safety", "safety", "  Tractors  ", ""],
        color: "#D9A441",
        icon: "fa-solid fa-tractor",
      })
      .expect(201);
    expect(res.body.icon).toBe("tractor"); // normalised from the fa- form
    expect(res.body.color).toBe("#d9a441");
    expect(res.body.tags).toEqual(["Safety", "Tractors"]); // trimmed + de-duped (case-insensitive)
  });

  it("defaults branding when omitted", async () => {
    const res = await asBrand(request(app).get("/v1/units/me")).expect(200);
    expect(res.body.icon).toBe("tractor"); // set above; a fresh unit would default to the preset default
  });

  it("rejects an icon outside the predefined set", async () => {
    const res = await asBrand(request(app).patch("/v1/units/me")).send({ icon: "skull" }).expect(400);
    expect(res.body.error).toBe("INVALID");
  });

  it("rejects a malformed colour", async () => {
    await asBrand(request(app).patch("/v1/units/me")).send({ color: "red" }).expect(400);
  });

  it("rejects non-array tags", async () => {
    await asBrand(request(app).patch("/v1/units/me")).send({ tags: "a,b,c" }).expect(400);
  });

  it("updates branding via PATCH and reflects it on the public profile", async () => {
    const patched = await asBrand(request(app).patch("/v1/units/me"))
      .send({ icon: "leaf", color: "#2e8f55", tags: ["organic"] })
      .expect(200);
    expect(patched.body.icon).toBe("leaf");
    const unitId = patched.body.unitId;
    const profile = await request(app).get(`/v1/public/units/${unitId}`).expect(200);
    expect(profile.body.icon).toBe("leaf");
    expect(profile.body.color).toBe("#2e8f55");
    expect(profile.body.tags).toEqual(["organic"]);
    const dir = await request(app).get("/v1/public/units").expect(200);
    const inDir = dir.body.units.find((u) => u.unitId === unitId);
    expect(inDir.icon).toBe("leaf");
    expect(inDir.tags).toEqual(["organic"]);
  });
});

describe("authoring — exams + ownership", () => {
  let examId;
  beforeAll(async () => {
    await as(request(app).post("/v1/units"), OTHER).send({ name: "Other Unit" }).expect(201);
  });

  it("creates a draft exam", async () => {
    const res = await as(request(app).post("/v1/exams"))
      .send({
        title: "My Exam",
        description: "d",
        durationSec: 600,
        accessWindowDays: 5,
        passPct: 50,
        attemptsAllowed: 2,
        certValidMonths: 12,
        questionCount: 2,
        pricing: { mode: "free" },
      })
      .expect(201);
    expect(res.body.status).toBe("draft");
    examId = res.body.id;
  });

  it("validates exam input", async () => {
    await as(request(app).post("/v1/exams"))
      .send({
        title: "Bad",
        durationSec: 0,
        accessWindowDays: 1,
        passPct: 50,
        attemptsAllowed: 1,
        certValidMonths: 1,
        questionCount: 1,
        pricing: { mode: "free" },
      })
      .expect(400);
    await as(request(app).post("/v1/exams"))
      .send({
        title: "Bad2",
        durationSec: 60,
        accessWindowDays: 1,
        passPct: 150,
        attemptsAllowed: 1,
        certValidMonths: 1,
        questionCount: 1,
        pricing: { mode: "free" },
      })
      .expect(400);
    await as(request(app).post("/v1/exams"))
      .send({
        title: "Bad3",
        durationSec: 60,
        accessWindowDays: 1,
        passPct: 50,
        attemptsAllowed: 1,
        certValidMonths: 1,
        questionCount: 1,
        pricing: { mode: "paid" },
      })
      .expect(400);
  });

  it("blocks cross-unit reads/writes with 403", async () => {
    await as(request(app).get(`/v1/exams/${examId}`), OTHER).expect(403);
    await as(request(app).patch(`/v1/exams/${examId}`), OTHER)
      .send({ title: "Hijack" })
      .expect(403);
    await as(request(app).post(`/v1/exams/${examId}/questions`), OTHER)
      .send({
        type: "single",
        text: "x",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
      })
      .expect(403);
  });

  it("409s creating an exam without a unit", async () => {
    await as(request(app).post("/v1/exams"), "unitless")
      .send({
        title: "X",
        durationSec: 60,
        accessWindowDays: 1,
        passPct: 50,
        attemptsAllowed: 1,
        certValidMonths: 1,
        questionCount: 1,
        pricing: { mode: "free" },
      })
      .expect(409);
  });

  it("won't publish without enough questions, then publishes once questions exist", async () => {
    const early = await as(request(app).post(`/v1/exams/${examId}/publish`)).expect(400);
    expect(early.body.error).toBe("NOT_ENOUGH_QUESTIONS");

    await as(request(app).post(`/v1/exams/${examId}/questions`))
      .send({
        type: "single",
        text: "Q1",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
      })
      .expect(201);
    await as(request(app).post(`/v1/exams/${examId}/questions`))
      .send({
        type: "multi",
        text: "Q2",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
        ],
        correct: ["a", "c"],
      })
      .expect(201);

    const pub = await as(request(app).post(`/v1/exams/${examId}/publish`)).expect(200);
    expect(pub.body.status).toBe("published");
    await request(app).get(`/v1/published/exams/${examId}`).expect(200);
  });

  it("rejects an invalid question type", async () => {
    const res = await as(request(app).post(`/v1/exams/${examId}/questions`))
      .send({
        type: "ordering",
        text: "x",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
      })
      .expect(400);
    expect(res.body.error).toBe("INVALID_QUESTION");
  });

  it("lists questions with keys for the owner", async () => {
    const res = await as(request(app).get(`/v1/exams/${examId}/questions`)).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.questions[0].correct).toBeTruthy();
  });
});

describe("authoring — certificate templates", () => {
  const baseExam = (over) => ({
    title: "Tpl Exam",
    description: "d",
    durationSec: 60,
    accessWindowDays: 1,
    passPct: 50,
    attemptsAllowed: 1,
    certValidMonths: 1,
    questionCount: 1,
    pricing: { mode: "free" },
    ...over,
  });

  it("lists the ten predefined templates", async () => {
    const res = await request(app).get("/v1/cert-templates").expect(200);
    expect(res.body.templates.length).toBe(10);
    expect(res.body.defaultTemplate).toBeTruthy();
    expect(res.body.templates[0]).toHaveProperty("accent");
  });

  it("stores a chosen template on the exam", async () => {
    const res = await as(request(app).post("/v1/exams"))
      .send(baseExam({ certTemplate: "midnight" }))
      .expect(201);
    expect(res.body.certTemplate).toBe("midnight");
  });

  it("defaults the template when omitted", async () => {
    const res = await as(request(app).post("/v1/exams")).send(baseExam()).expect(201);
    expect(res.body.certTemplate).toBeTruthy();
  });

  it("rejects an unknown template", async () => {
    await as(request(app).post("/v1/exams"))
      .send(baseExam({ certTemplate: "neon-glow" }))
      .expect(400);
  });

  it("the published read surface carries the exam's template", async () => {
    const one = await request(app).get("/v1/published/exams/pesticide-basics").expect(200);
    expect(one.body.certTemplate).toBe("botanical");
  });
});

describe("authoring — enable/disable gating (unit + exam)", () => {
  const TOG = "toggle-owner";
  const asTog = (req) => req.set("x-academy-user", TOG);
  let unitId;
  let examId;

  beforeAll(async () => {
    const unit = await asTog(request(app).post("/v1/units")).send({ name: "Toggle Unit" }).expect(201);
    unitId = unit.body.unitId;
    const exam = await asTog(request(app).post("/v1/exams"))
      .send({
        title: "Toggle Exam",
        durationSec: 60,
        accessWindowDays: 1,
        passPct: 50,
        attemptsAllowed: 1,
        certValidMonths: 1,
        questionCount: 1,
        pricing: { mode: "free" },
      })
      .expect(201);
    examId = exam.body.id;
    expect(exam.body.enabled).toBe(true); // new exams default to enabled
    await asTog(request(app).post(`/v1/exams/${examId}/questions`))
      .send({ type: "single", text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
    await asTog(request(app).post(`/v1/exams/${examId}/publish`)).expect(200);
    await request(app).get(`/v1/published/exams/${examId}`).expect(200); // takeable once published
  });

  it("disabling an exam pulls it from the published surface (404) but keeps it published for the owner", async () => {
    const dis = await asTog(request(app).post(`/v1/exams/${examId}/disable`)).expect(200);
    expect(dis.body.enabled).toBe(false);
    expect(dis.body.status).toBe("published"); // publish state untouched

    await request(app).get(`/v1/published/exams/${examId}`).expect(404); // untakeable
    const list = await request(app).get("/v1/published/exams").expect(200);
    expect(list.body.exams.some((e) => e.id === examId)).toBe(false);

    // Hidden from the unit's public profile too.
    const profile = await request(app).get(`/v1/public/units/${unitId}`).expect(200);
    expect(profile.body.exams.some((e) => e.id === examId)).toBe(false);

    // Owner still sees it (so they can re-enable).
    const mine = await asTog(request(app).get("/v1/exams")).expect(200);
    expect(mine.body.exams.find((e) => e.id === examId).enabled).toBe(false);
  });

  it("re-enabling an exam makes it takeable again", async () => {
    await asTog(request(app).post(`/v1/exams/${examId}/enable`)).expect(200);
    await request(app).get(`/v1/published/exams/${examId}`).expect(200);
  });

  it("only the owner can toggle an exam", async () => {
    await as(request(app).post(`/v1/exams/${examId}/disable`), OTHER).expect(403);
    await as(request(app).post(`/v1/exams/${examId}/enable`), OTHER).expect(403);
  });

  it("disabling the UNIT makes all its exams untakeable and hides it from the public directory", async () => {
    const dis = await asTog(request(app).post("/v1/units/me/disable")).expect(200);
    expect(dis.body.status).toBe("disabled");

    await request(app).get(`/v1/published/exams/${examId}`).expect(404); // exam untakeable via disabled unit
    const list = await request(app).get("/v1/published/exams").expect(200);
    expect(list.body.exams.some((e) => e.ownerUnitId === unitId)).toBe(false);

    await request(app).get(`/v1/public/units/${unitId}`).expect(404); // unit hidden publicly
    const dir = await request(app).get("/v1/public/units").expect(200);
    expect(dir.body.units.some((u) => u.unitId === unitId)).toBe(false);

    // Owner still manages it.
    const me = await asTog(request(app).get("/v1/units/me")).expect(200);
    expect(me.body.status).toBe("disabled");
  });

  it("re-enabling the unit restores its exams to the catalog", async () => {
    const en = await asTog(request(app).post("/v1/units/me/enable")).expect(200);
    expect(en.body.status).toBe("active");
    await request(app).get(`/v1/published/exams/${examId}`).expect(200);
    await request(app).get(`/v1/public/units/${unitId}`).expect(200);
  });

  it("is idempotent: double-disable / double-enable stays 200 with stable state", async () => {
    await asTog(request(app).post(`/v1/exams/${examId}/disable`)).expect(200);
    const again = await asTog(request(app).post(`/v1/exams/${examId}/disable`)).expect(200);
    expect(again.body.enabled).toBe(false);
    await asTog(request(app).post(`/v1/exams/${examId}/enable`)).expect(200);
    const en2 = await asTog(request(app).post(`/v1/exams/${examId}/enable`)).expect(200);
    expect(en2.body.enabled).toBe(true);
    await asTog(request(app).post("/v1/units/me/disable")).expect(200);
    expect((await asTog(request(app).post("/v1/units/me/disable"))).body.status).toBe("disabled");
    await asTog(request(app).post("/v1/units/me/enable")).expect(200);
  });

  it("re-enabling an exam while its unit stays disabled does NOT make it takeable", async () => {
    await asTog(request(app).post("/v1/units/me/disable")).expect(200);
    await asTog(request(app).post(`/v1/exams/${examId}/enable`)).expect(200); // exam enabled…
    await request(app).get(`/v1/published/exams/${examId}`).expect(404); // …but unit disabled ⇒ still hidden
    await asTog(request(app).post("/v1/units/me/enable")).expect(200); // restore
  });

  it("404s enabling/disabling an unknown exam, and unit toggle with no unit", async () => {
    await asTog(request(app).post("/v1/exams/no-such-exam/disable")).expect(404);
    await asTog(request(app).post("/v1/exams/no-such-exam/enable")).expect(404);
    await as(request(app).post("/v1/units/me/disable"), "toggle-no-unit").expect(404);
    await as(request(app).post("/v1/units/me/enable"), "toggle-no-unit").expect(404);
  });

  it("individually disabling one exam decrements the unit's public examCount", async () => {
    // TOG has one published exam; add a second, then disable it.
    const two = await asTog(request(app).post("/v1/exams"))
      .send({ title: "Second", durationSec: 60, accessWindowDays: 1, passPct: 50, attemptsAllowed: 1, certValidMonths: 1, questionCount: 1, pricing: { mode: "free" } })
      .expect(201);
    await asTog(request(app).post(`/v1/exams/${two.body.id}/questions`))
      .send({ type: "single", text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
    await asTog(request(app).post(`/v1/exams/${two.body.id}/publish`)).expect(200);
    const before = await request(app).get("/v1/public/units").expect(200);
    expect(before.body.units.find((u) => u.unitId === unitId).examCount).toBe(2);
    await asTog(request(app).post(`/v1/exams/${two.body.id}/disable`)).expect(200);
    const after = await request(app).get("/v1/public/units").expect(200);
    const row = after.body.units.find((u) => u.unitId === unitId);
    expect(row).toBeTruthy(); // unit still listed
    expect(row.examCount).toBe(1); // but the disabled exam no longer counts
  });
});

describe("authoring — validateExamInput (pure, all branches)", () => {
  const base = () => ({
    title: "T",
    description: "d",
    durationSec: 600,
    accessWindowDays: 5,
    passPct: 60,
    attemptsAllowed: 2,
    certValidMonths: 12,
    questionCount: 3,
    pricing: { mode: "free" },
  });
  const bad = (over) => validateExamInput({ ...base(), ...over }).error;

  it("accepts a complete valid body and defaults certTemplate", () => {
    const r = validateExamInput(base());
    expect(r.error).toBeUndefined();
    expect(r.value.certTemplate).toBeTruthy();
  });
  it("rejects each out-of-range numeric field", () => {
    expect(bad({ title: "  " })).toMatch(/title required/);
    expect(bad({ durationSec: 0 })).toMatch(/durationSec/);
    expect(bad({ accessWindowDays: 0 })).toMatch(/accessWindowDays/);
    expect(bad({ passPct: 0 })).toMatch(/passPct/);
    expect(bad({ passPct: 101 })).toMatch(/passPct/);
    expect(bad({ attemptsAllowed: 0 })).toMatch(/attemptsAllowed/);
    expect(bad({ certValidMonths: 0 })).toMatch(/certValidMonths/);
    expect(bad({ questionCount: 0 })).toMatch(/questionCount/);
  });
  it("rejects a bad pricing mode and a paid exam without a positive price", () => {
    expect(bad({ pricing: { mode: "trial" } })).toMatch(/free\|paid/);
    expect(bad({ pricing: { mode: "paid", priceRol: 0 } })).toMatch(/priceRol/);
  });
  it("accepts a paid exam and echoes priceRol", () => {
    const r = validateExamInput({ ...base(), pricing: { mode: "paid", priceRol: 15 } });
    expect(r.value.pricing).toEqual({ mode: "paid", priceRol: 15 });
  });
  it("rejects an unknown certTemplate", () => {
    expect(bad({ certTemplate: "neon-glow" })).toMatch(/certTemplate/);
  });
  it("floors fractional numeric input", () => {
    const r = validateExamInput({ ...base(), durationSec: "600.9" });
    expect(r.value.durationSec).toBe(600);
  });
  it("in partial mode validates only supplied fields and does not default certTemplate", () => {
    const ok = validateExamInput({ passPct: 80 }, { partial: true });
    expect(ok.error).toBeUndefined();
    expect(ok.value).toEqual({ passPct: 80 }); // nothing else added
    const err = validateExamInput({ durationSec: 0 }, { partial: true });
    expect(err.error).toMatch(/durationSec/);
  });
});

describe("authoring — exam PATCH / unpublish / publish negatives", () => {
  const OWN = "patch-owner";
  const asOwn = (req) => req.set("x-academy-user", OWN);
  let examId;
  beforeAll(async () => {
    await asOwn(request(app).post("/v1/units")).send({ name: "Patch Unit" }).expect(201);
    const e = await asOwn(request(app).post("/v1/exams"))
      .send({ title: "P", durationSec: 600, accessWindowDays: 5, passPct: 60, attemptsAllowed: 2, certValidMonths: 12, questionCount: 1, pricing: { mode: "free" } })
      .expect(201);
    examId = e.body.id;
    await asOwn(request(app).post(`/v1/exams/${examId}/questions`))
      .send({ type: "single", text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
  });

  it("PATCH updates a single field and leaves the rest unchanged", async () => {
    const r = await asOwn(request(app).patch(`/v1/exams/${examId}`)).send({ passPct: 80 }).expect(200);
    expect(r.body.passPct).toBe(80);
    expect(r.body.title).toBe("P"); // untouched
  });
  it("PATCH still validates supplied fields (durationSec 0 → 400)", async () => {
    await asOwn(request(app).patch(`/v1/exams/${examId}`)).send({ durationSec: 0 }).expect(400);
  });
  it("PATCH an unknown exam → 404", async () => {
    await asOwn(request(app).patch(`/v1/exams/ghost`)).send({ passPct: 70 }).expect(404);
  });
  it("publish is owner-scoped (403 cross-unit) and 404 for an unknown exam", async () => {
    await asOwn(request(app).post(`/v1/exams/${examId}/publish`)).expect(200);
    await as(request(app).post(`/v1/exams/${examId}/publish`), OTHER).expect(403);
    await asOwn(request(app).post(`/v1/exams/ghost/publish`)).expect(404);
  });
  it("unpublish returns the exam to draft and drops it from the published surface", async () => {
    await request(app).get(`/v1/published/exams/${examId}`).expect(200);
    const un = await asOwn(request(app).post(`/v1/exams/${examId}/unpublish`)).expect(200);
    expect(un.body.status).toBe("draft");
    await request(app).get(`/v1/published/exams/${examId}`).expect(404);
    await as(request(app).post(`/v1/exams/${examId}/unpublish`), OTHER).expect(403);
    await asOwn(request(app).post(`/v1/exams/ghost/unpublish`)).expect(404);
  });
});

describe("authoring — question PATCH / DELETE", () => {
  const OWN = "q-owner";
  const asOwn = (req) => req.set("x-academy-user", OWN);
  let examId;
  beforeAll(async () => {
    await asOwn(request(app).post("/v1/units")).send({ name: "Q Unit" }).expect(201);
    const e = await asOwn(request(app).post("/v1/exams"))
      .send({ title: "Q", durationSec: 600, accessWindowDays: 5, passPct: 60, attemptsAllowed: 2, certValidMonths: 12, questionCount: 1, pricing: { mode: "free" } })
      .expect(201);
    examId = e.body.id;
    await asOwn(request(app).post(`/v1/exams/${examId}/questions`))
      .send({ id: "q1", type: "single", text: "Q1", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
  });

  it("PATCH a question returns 200 (vs 201 on create)", async () => {
    const r = await asOwn(request(app).patch(`/v1/exams/${examId}/questions/q1`))
      .send({ type: "single", text: "Q1 edited", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["b"] })
      .expect(200);
    expect(r.body.correct).toEqual(["b"]);
  });
  it("DELETE removes a question, and a second delete reports deleted:false", async () => {
    const first = await asOwn(request(app).delete(`/v1/exams/${examId}/questions/q1`)).expect(200);
    expect(first.body.deleted).toBe(true);
    const again = await asOwn(request(app).delete(`/v1/exams/${examId}/questions/q1`)).expect(200);
    expect(again.body.deleted).toBe(false);
  });
  it("404s question ops on an unknown exam", async () => {
    await asOwn(request(app).get(`/v1/exams/ghost/questions`)).expect(404);
    await asOwn(request(app).delete(`/v1/exams/ghost/questions/q1`)).expect(404);
  });
});

describe("authoring — question-bank unavailable (503 degradation)", () => {
  const OWN = "down-owner";
  const asOwn = (req) => req.set("x-academy-user", OWN);
  let downApp;
  let examId;
  beforeAll(async () => {
    // Create the unit + a draft exam on the REAL app (create needs no bank)…
    await asOwn(request(app).post("/v1/units")).send({ name: "Down Unit" }).expect(201);
    const e = await asOwn(request(app).post("/v1/exams"))
      .send({ title: "D", durationSec: 600, accessWindowDays: 5, passPct: 60, attemptsAllowed: 2, certValidMonths: 12, questionCount: 1, pricing: { mode: "free" } })
      .expect(201);
    examId = e.body.id;
    downApp = downBankApp(); // …then drive bank-dependent routes against a failing bank
  });

  it("publish → 503 QUESTION_BANK_UNAVAILABLE", async () => {
    const r = await asOwn(request(downApp).post(`/v1/exams/${examId}/publish`)).expect(503);
    expect(r.body.error).toBe("QUESTION_BANK_UNAVAILABLE");
  });
  it("question upsert / list / delete → 503", async () => {
    await asOwn(request(downApp).post(`/v1/exams/${examId}/questions`))
      .send({ type: "single", text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(503);
    await asOwn(request(downApp).get(`/v1/exams/${examId}/questions`)).expect(503);
    await asOwn(request(downApp).delete(`/v1/exams/${examId}/questions/q1`)).expect(503);
  });
});

describe("authoring — unit PATCH edge/negatives", () => {
  const OWN = "unit-patch-owner";
  const asOwn = (req) => req.set("x-academy-user", OWN);
  beforeAll(async () => {
    await asOwn(request(app).post("/v1/units")).send({ name: "Unit PATCH" }).expect(201);
  });
  it("rejects a blank name", async () => {
    const r = await asOwn(request(app).patch("/v1/units/me")).send({ name: "   " }).expect(400);
    expect(r.body.error).toBe("INVALID");
  });
  it("persists a contactEmail update", async () => {
    const r = await asOwn(request(app).patch("/v1/units/me")).send({ contactEmail: "hi@unit.example" }).expect(200);
    expect(r.body.contactEmail).toBe("hi@unit.example");
  });
  it("404s a PATCH when the caller has no unit", async () => {
    await as(request(app).patch("/v1/units/me"), "no-unit-patcher").send({ description: "x" }).expect(404);
  });
});

describe("authoring — read-surface field contract (no payout leak)", () => {
  const OWN = "leak-owner";
  const asOwn = (req) => req.set("x-academy-user", OWN);
  let unitId;
  let examId;
  beforeAll(async () => {
    const u = await asOwn(request(app).post("/v1/units")).send({ name: "Leak Unit" }).expect(201);
    unitId = u.body.unitId;
    const e = await asOwn(request(app).post("/v1/exams"))
      .send({ title: "L", durationSec: 600, accessWindowDays: 5, passPct: 60, attemptsAllowed: 2, certValidMonths: 12, questionCount: 1, pricing: { mode: "paid", priceRol: 10 } })
      .expect(201);
    examId = e.body.id;
    await asOwn(request(app).post(`/v1/exams/${examId}/questions`))
      .send({ type: "single", text: "Q", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
    await asOwn(request(app).post(`/v1/exams/${examId}/publish`)).expect(200);
  });

  it("the exam-center read surface carries payoutUserId", async () => {
    const r = await request(app).get(`/v1/published/exams/${examId}`).expect(200);
    expect(r.body.payoutUserId).toBe(OWN); // payout defaults to the owner
  });
  it("the PUBLIC unit profile card omits payoutUserId", async () => {
    const r = await request(app).get(`/v1/public/units/${unitId}`).expect(200);
    const card = r.body.exams.find((e) => e.id === examId);
    expect(card).toBeTruthy();
    expect(card.payoutUserId).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain("payoutUserId");
  });
});
