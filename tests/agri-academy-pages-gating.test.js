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

  it("redirects /agri-academy → /agri-academy-units.html when enabled", async () => {
    await setEnabled(true);
    const res = await request(app).get("/agri-academy").expect(302);
    expect(res.headers.location).toBe("/agri-academy-units.html");
  });
});
