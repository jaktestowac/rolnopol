import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// Crew Office HTML page gating — PRD §12 rule 1 and §9.1.3.
//
// Two gates guard every crew page, and BOTH fail to the same HTML 404 page:
//   1. `crewOfficeEnabled` off  ⇒ the module does not exist.
//   2. no session               ⇒ the module does not exist *to you* (§9.1.3).
// The anonymous half of that contract lives in crew-auth.test.js, which asserts
// the two sweeps byte-match. This file owns the flag half plus the /crew redirect.
const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const notFoundStats = require("../helpers/notfound-stats.js");

const FLAG = "crewOfficeEnabled";

const PAGES = ["/crew.html", "/crew-member.html", "/crew-leave.html", "/crew-tools.html", "/crew-explorer.html"];

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

describe("Crew Office HTML page gating", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenHelpers.generateToken("crew-gating-user");
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  it("404s every crew page when the master flag is disabled", async () => {
    await setEnabled(false);
    for (const page of [...PAGES, "/crew"]) {
      const res = await request(app).get(page).set("Cookie", `rolnopolToken=${token}`).expect(404);
      expect(res.headers["content-type"]).toContain("text/html");
    }
  });

  it("serves every crew page when the flag is enabled and the caller has a session", async () => {
    await setEnabled(true);
    for (const page of PAGES) {
      const res = await request(app).get(page).set("Cookie", `rolnopolToken=${token}`).expect(200);
      expect(res.headers["content-type"]).toContain("text/html");
      // Every crew page carries the module marker the page controllers scope to.
      expect(res.text).toContain("crew-page");
    }
  });

  it("redirects /crew → /crew.html when enabled for a logged-in caller", async () => {
    await setEnabled(true);
    const res = await request(app).get("/crew").set("Cookie", `rolnopolToken=${token}`).expect(302);
    expect(res.headers.location).toBe("/crew.html");
  });

  it("counts a gated crew page as an HTML not-found (stats parity with every other gate)", async () => {
    await setEnabled(false);
    const stats = notFoundStats.getStats();
    const before = stats.html.paths["/crew.html"] || 0;

    await request(app).get("/crew.html").set("Cookie", `rolnopolToken=${token}`).expect(404);

    expect(notFoundStats.getStats().html.paths["/crew.html"]).toBe(before + 1);
  });

  it("a sub-pillar flag cannot resurrect the module while the master flag is off", async () => {
    // §5.2 rule 1: master wins, enforced in code — not a partially-working module.
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { crewOfficeEnabled: false, crewLeaveEnabled: true, crewToolsEnabled: true } })
      .expect(200);

    for (const page of [...PAGES, "/crew"]) {
      await request(app).get(page).set("Cookie", `rolnopolToken=${token}`).expect(404);
    }
    await request(app).get("/api/v1/crew/health").set("Cookie", `rolnopolToken=${token}`).expect(404);
  });
});
