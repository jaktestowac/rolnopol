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
    expect(blog.text).toContain("Farmlog blog detail");
    expect(post.text).toContain("Post Detail");
    expect(hub.text).toContain("/js/pages/farmlog.js");
    expect(blog.text).toContain("/js/pages/farmlog.js");
    expect(post.text).toContain("/js/pages/farmlog.js");
  });

  it("the hub ships the discovery feed: both paging modes and the new-posts pill", async () => {
    await setFarmlogEnabled(true);
    const hub = await request(app).get("/farmlog.html").expect(200);

    // The twin has to be reachable from the page, not just from the query string —
    // it is the control the whole feature is built to contrast.
    expect(hub.text).toContain('id="farmlogPagingMode"');
    expect(hub.text).toContain('value="offset"');
    expect(hub.text).toContain('value="cursor"');
    // Posts arriving mid-read are counted here rather than pushed into the window.
    expect(hub.text).toContain('id="farmlogFeedNew"');

    const controller = await request(app).get("/js/pages/farmlog.js").expect(200);
    expect(controller.text).toContain("IntersectionObserver");
    expect(controller.text).toContain("_loadMorePosts");
    // Every card carries its id, so "did this window repeat a row?" is answerable
    // from the DOM — the assertion the offset/cursor comparison rests on.
    expect(controller.text).toContain("data-post-id");
  });
});
