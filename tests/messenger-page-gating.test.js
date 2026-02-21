import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setMessengerEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { messengerEnabled: enabled } })
    .expect(200);
}

describe("Messenger HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 page when messenger feature flag is disabled", async () => {
    await setMessengerEnabled(false);

    const res = await request(app).get("/messenger.html").expect(404);

    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves messenger page when messenger feature flag is enabled", async () => {
    await setMessengerEnabled(true);

    const res = await request(app).get("/messenger.html").expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Messenger - Rolnopol");
    expect(res.text).toContain('id="friendsList"');
  });
});
