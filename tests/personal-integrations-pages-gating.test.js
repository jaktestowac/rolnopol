import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setPersonalIntegrationsEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { personalApiKeysEnabled: enabled } })
    .expect(200);
}

describe("Personal integrations HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 pages when the personal integrations feature flag is disabled", async () => {
    await setPersonalIntegrationsEnabled(false);

    const page = await request(app).get("/integrations.html").expect(404);
    const routeAlias = await request(app).get("/integrations").expect(404);

    expect(page.headers["content-type"]).toContain("text/html");
    expect(routeAlias.headers["content-type"]).toContain("text/html");
  });

  it("serves the personal integrations page when the feature flag is enabled", async () => {
    await setPersonalIntegrationsEnabled(true);

    const page = await request(app).get("/integrations.html").expect(200);
    const routeAlias = await request(app).get("/integrations").expect(302);

    expect(routeAlias.headers.location).toBe("/integrations.html");
    expect(page.text).toContain("Personal Integrations");
    expect(page.text).toContain("/js/pages/integrations.js");
  });

  it("serves the integrations page when only webhooks are enabled", async () => {
    await request(app)
      .put("/api/v1/feature-flags")
      .send({ flags: { personalApiKeysEnabled: false, integrationsWebhooksEnabled: true } })
      .expect(200);

    const page = await request(app).get("/integrations.html").expect(200);
    const routeAlias = await request(app).get("/integrations").expect(302);

    expect(routeAlias.headers.location).toBe("/integrations.html");
    expect(page.text).toContain("Personal Integrations");
  });
});
