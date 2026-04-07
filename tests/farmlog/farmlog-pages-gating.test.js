import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setFarmlogEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { rolnopolFarmlogEnabled: enabled } })
    .expect(200);
}

describe("Farmlog HTML pages gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 pages when Farmlog feature flag is disabled", async () => {
    await setFarmlogEnabled(false);

    const hub = await request(app).get("/farmlog.html").expect(404);
    const blog = await request(app).get("/farmlog-blog.html?blog=abc").expect(404);
    const post = await request(app).get("/farmlog-post.html?blog=abc&post=xyz").expect(404);

    expect(hub.headers["content-type"]).toContain("text/html");
    expect(blog.headers["content-type"]).toContain("text/html");
    expect(post.headers["content-type"]).toContain("text/html");
  });

  it("serves Farmlog pages when feature flag is enabled", async () => {
    await setFarmlogEnabled(true);

    const hub = await request(app).get("/farmlog.html").expect(200);
    const blog = await request(app).get("/farmlog-blog.html?blog=abc").expect(200);
    const post = await request(app).get("/farmlog-post.html?blog=abc&post=xyz").expect(200);

    expect(hub.text).toContain("Farmlog Space");
    expect(blog.text).toContain("Blog Detail");
    expect(post.text).toContain("Post Detail");
    expect(hub.text).toContain("/js/pages/farmlog.js");
    expect(blog.text).toContain("/js/pages/farmlog.js");
    expect(post.text).toContain("/js/pages/farmlog.js");
  });
});
