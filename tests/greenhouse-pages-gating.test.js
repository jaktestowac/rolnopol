import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

const FLAG = "greenhouseControlRoomEnabled";

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

describe("Greenhouse HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
    }
  });

  it("returns 404 for /greenhouse.html when the flag is disabled", async () => {
    await setEnabled(false);
    const res = await request(app).get("/greenhouse.html").expect(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the greenhouse page when the flag is enabled", async () => {
    await setEnabled(true);
    const res = await request(app).get("/greenhouse.html").expect(200);
    expect(res.text).toContain("Grow a Plant");
    expect(res.text).toContain("/js/pages/greenhouse.js");
  });

  it("redirects /greenhouse → /greenhouse.html when enabled", async () => {
    await setEnabled(true);
    const res = await request(app).get("/greenhouse").expect(302);
    expect(res.headers.location).toBe("/greenhouse.html");
  });
});
