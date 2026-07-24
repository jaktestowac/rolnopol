import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

const FLAG = "agriAcademyEnabled";

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

const PAGES = [
  "/agri-academy-units.html",
  "/agri-academy-unit.html",
  "/agri-academy-leaderboard.html",
  "/agri-academy.html",
  "/agri-academy-authoring.html",
  "/agri-academy-certificate.html",
  "/agri-academy-status.html",
];

describe("AgriAcademy HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getFlags();
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  it("404s every AgriAcademy page when the flag is disabled", async () => {
    await setEnabled(false);
    for (const p of PAGES) {
      const res = await request(app).get(p).expect(404);
      expect(res.headers["content-type"]).toContain("text/html");
    }
  });

  it("serves the pages when the flag is enabled", async () => {
    await setEnabled(true);
    const units = await request(app).get("/agri-academy-units.html").expect(200);
    expect(units.text).toContain("Certification Units");
    const leaderboard = await request(app).get("/agri-academy-leaderboard.html").expect(200);
    expect(leaderboard.text).toContain("Leaderboards");
    const taker = await request(app).get("/agri-academy.html").expect(200);
    expect(taker.text).toContain("Take an exam");
    const authoringPage = await request(app).get("/agri-academy-authoring.html").expect(200);
    expect(authoringPage.text).toContain("Unit console");
    const certPage = await request(app).get("/agri-academy-certificate.html").expect(200);
    expect(certPage.text).toContain("Certificate of Achievement");
    const statusPage = await request(app).get("/agri-academy-status.html").expect(200);
    expect(statusPage.text).toContain("System Status");
  });

  it("the certificate page ships the print-to-PDF download control + colour-exact print CSS", async () => {
    await setEnabled(true);
    const cert = await request(app).get("/agri-academy-certificate.html").expect(200);
    expect(cert.text).toContain('id="downloadBtn"');
    expect(cert.text).toContain("Download PDF");
    // Force template colours into the saved PDF + a landscape page.
    expect(cert.text).toContain("print-color-adjust: exact");
    expect(cert.text).toMatch(/@page\s*\{[^}]*landscape/);
  });

  it("the taker page ships the exam-preview modal", async () => {
    await setEnabled(true);
    const taker = await request(app).get("/agri-academy.html").expect(200);
    expect(taker.text).toContain('id="previewModal"');
    expect(taker.text).toContain("Exam preview");
    expect(taker.text).toContain("data-preview="); // per-card preview trigger
    expect(taker.text).toContain("function openPreview");
  });

  it("the taker page enrolls into a ready-to-start panel (no auto-start)", async () => {
    await setEnabled(true);
    const taker = await request(app).get("/agri-academy.html").expect(200);
    // Enroll lands on an explicit "Start exam" step instead of dropping straight
    // into the timed attempt (start consumes the attempt + begins the clock).
    expect(taker.text).toContain("function showReady");
    expect(taker.text).toContain('id="startBtn"');
    expect(taker.text).toContain("Start exam");
  });

  it("the public unit profile ships the exam-preview modal next to Enroll & take", async () => {
    await setEnabled(true);
    const profile = await request(app).get("/agri-academy-unit.html").expect(200);
    expect(profile.text).toContain('id="previewModal"');
    expect(profile.text).toContain("Exam preview");
    expect(profile.text).toContain("data-preview="); // per-card preview trigger
    expect(profile.text).toContain("Enroll &amp; take →"); // sits alongside the enroll link
    expect(profile.text).toContain("function openPreview");
  });

  it("redirects /agri-academy → /agri-academy-units.html when enabled", async () => {
    await setEnabled(true);
    const res = await request(app).get("/agri-academy").expect(302);
    expect(res.headers.location).toBe("/agri-academy-units.html");
  });
});
