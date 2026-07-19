import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

describe("Two-factor HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 pages when the 2FA feature flag is disabled", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { twoFactorAuthEnabled: false } })
      .expect(200);

    const page = await request(app).get("/two-factor.html").expect(404);
    const routeAlias = await request(app).get("/two-factor").expect(404);

    expect(page.headers["content-type"]).toContain("text/html");
    expect(routeAlias.headers["content-type"]).toContain("text/html");
  });

  it("serves the 2FA page when the feature flag is enabled", async () => {
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { twoFactorAuthEnabled: true } })
      .expect(200);

    const page = await request(app).get("/two-factor.html").expect(200);
    const routeAlias = await request(app).get("/two-factor").expect(302);

    expect(routeAlias.headers.location).toBe("/two-factor.html");
    expect(page.text).toContain("Two-Factor Authentication Settings");
    expect(page.text).toContain("/js/pages/two-factor.js");
  });
});
