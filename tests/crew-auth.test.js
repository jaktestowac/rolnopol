import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// Crew Office is logged-in-only — pages AND API (PRD §9.1, goal G9).
//
// The two easily-conflated codes are pinned here on purpose: no credentials is
// 401, a *present but rejected* token is 403. A test asserting the wrong one
// passes for the wrong reason, so §9.1.2's table is transcribed literally.
//
// Phase 0 scope: `/api/v1/crew/health` is the only API path that exists yet.
// The graph endpoint inherits this exact middleware chain in Phase 2 and gets
// its own assertions there.
const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");

const FLAG = "crewOfficeEnabled";
const HEALTH = "/api/v1/crew/health";
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

describe("Crew Office — authentication is mandatory", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenHelpers.generateToken("crew-auth-user");
  });

  afterAll(async () => {
    if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  });

  describe("the API status contract (§9.1.2)", () => {
    it("404s for an authenticated caller when the flag is off — flag is checked before auth", async () => {
      await setEnabled(false);
      await request(app).get(HEALTH).set("Cookie", `rolnopolToken=${token}`).expect(404);
    });

    it("401s with no credentials at all", async () => {
      await setEnabled(true);
      const res = await request(app).get(HEALTH).expect(401);
      expect(res.body?.error).toBe("Access token required");
    });

    it("403s — not 401 — for a present but invalid or expired token", async () => {
      await setEnabled(true);
      const res = await request(app).get(HEALTH).set("Cookie", "rolnopolToken=not-a-real-token").expect(403);
      expect(res.body?.error).toBe("Invalid or expired token");
    });

    it("401s when only an x-api-key is supplied — personal API keys never authenticate here (§9.1.1)", async () => {
      await setEnabled(true);
      // No crew scope exists, so admitting keys would silently widen every
      // already-issued key. The key is ignored, not validated: 401, not 403.
      const res = await request(app).get(HEALTH).set("x-api-key", "any-key-at-all").expect(401);
      expect(res.body?.error).toBe("Access token required");
    });

    it("serves health for a valid session", async () => {
      await setEnabled(true);
      const res = await request(app).get(HEALTH).set("Cookie", `rolnopolToken=${token}`).expect(200);
      const body = res.body?.data ?? res.body;
      expect(body.status).toBeTruthy();
      expect(Array.isArray(body.pillars)).toBe(true);
    });

    it("accepts the session from a Bearer header as well as the cookie", async () => {
      await setEnabled(true);
      await request(app).get(HEALTH).set("Authorization", `Bearer ${token}`).expect(200);
    });
  });

  describe("pages: anonymous is indistinguishable from disabled (§12 rule 1b)", () => {
    it("the anonymous flag-on page sweep byte-matches the flag-off sweep", async () => {
      await setEnabled(false);
      const disabled = [];
      for (const page of PAGES) {
        const res = await request(app).get(page).expect(404);
        disabled.push({ page, status: res.status, type: res.headers["content-type"], body: res.text });
      }

      await setEnabled(true);
      const anonymous = [];
      for (const page of PAGES) {
        const res = await request(app).get(page).expect(404);
        anonymous.push({ page, status: res.status, type: res.headers["content-type"], body: res.text });
      }

      expect(anonymous).toEqual(disabled);
    });

    it("an invalid session is treated as anonymous on pages, not as a 403", async () => {
      await setEnabled(true);
      const res = await request(app).get("/crew.html").set("Cookie", "rolnopolToken=not-a-real-token").expect(404);
      expect(res.headers["content-type"]).toContain("text/html");
    });

    it("/crew does not redirect for an anonymous caller — it 404s", async () => {
      await setEnabled(true);
      await request(app).get("/crew").expect(404);
    });
  });
});
