import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setObservatoryEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { observatoryEnabled: enabled } })
    .expect(200);
}

describe("Observatory feature-flag gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns a 404 page for /operator/observatory.html when the flag is disabled", async () => {
    await setObservatoryEnabled(false);

    const res = await request(app).get("/operator/observatory.html").expect(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("returns 404 JSON for the REST snapshot endpoint when the flag is disabled", async () => {
    await setObservatoryEnabled(false);

    const res = await request(app).get("/api/v1/observatory").expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Observatory not found");
  });

  it("returns 404 JSON for the SSE stream endpoint when the flag is disabled", async () => {
    await setObservatoryEnabled(false);

    const res = await request(app).get("/api/v1/observatory/stream").expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Observatory not found");
  });

  it("serves the observatory page with the shared nav chrome when the flag is enabled", async () => {
    await setObservatoryEnabled(true);

    const res = await request(app).get("/operator/observatory.html").expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain('id="header-component"');
    expect(res.text).toContain('id="footer-component"');
    expect(res.text).toContain("/js/components.js");
    expect(res.text).toContain('initNavigation("observatory")');
  });

  it("still redirects /operator/observatory and the astronomy alias when enabled", async () => {
    await setObservatoryEnabled(true);

    const shortcut = await request(app).get("/operator/observatory").expect(302);
    expect(shortcut.headers.location).toBe("/operator/observatory.html");

    const alias = await request(app).get("/operator/astronomy").expect(302);
    expect(alias.headers.location).toBe("/operator/observatory.html");
  });

  it("hides shortcuts behind the same gate when disabled (no redirect leak)", async () => {
    await setObservatoryEnabled(false);

    const shortcut = await request(app).get("/operator/observatory").expect(404);
    expect(shortcut.headers["content-type"]).toContain("text/html");

    const alias = await request(app).get("/operator/astronomy").expect(404);
    expect(alias.headers["content-type"]).toContain("text/html");
  });

  it("exposes the flag from GET /api/v1/feature-flags with a false default", async () => {
    await setObservatoryEnabled(false);

    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    expect(res.body.data.flags).toHaveProperty("observatoryEnabled", false);
  });
});
