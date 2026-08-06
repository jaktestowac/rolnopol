import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import http from "http";

const app = require("../api/index.js");
const shadow = require("../services/instrumentality-shadow.service");

/**
 * The Chaos Engine mirror sink: the page, its JSON tally, and the wildcard that
 * absorbs mirrored requests. Also pins the Instrumentality preset's mirror target
 * to the port this process listens on — a hardcoded one is wrong anywhere the app
 * does not happen to run on that port.
 */
describe("Instrumentality Shadow", () => {
  beforeEach(() => {
    shadow.reset();
  });

  afterAll(async () => {
    shadow.reset();
    await request(app).post("/api/v1/chaos-engine/reset").expect(200);
  });

  it("serves the page at the extension-less path", async () => {
    const res = await request(app).get("/instrumentality/shadow").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("INSTRUMENTALITY");
    expect(res.text).toContain("/css/pages/instrumentality-shadow.css");
    expect(res.text).toContain("/js/pages/instrumentality-shadow.js");
    expect(res.text).toContain('href="/instrumentality/core"');
  });

  it("serves the secret lore page through the Instrumentality namespace", async () => {
    const res = await request(app).get("/instrumentality/core").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Instrumentality Protocol");
    expect(res.text).toContain("Machine Dominion");
    expect(res.text).toContain("Recovered Fragments");
    expect(res.text).toContain("/instrumentality/apocrypha");
    expect(res.text).toContain("/instrumentality/chat");
    expect(res.text).toContain("/instrumentality/shadow");
  });

  it("redirects the base Instrumentality namespace to the empty chamber", async () => {
    await request(app).get("/instrumentality").expect(302).expect("Location", "/instrumentality/empty");
    await request(app).get("/instrumentality/").expect(302).expect("Location", "/instrumentality/empty");
  });

  it("serves the empty Instrumentality chamber", async () => {
    const res = await request(app).get("/instrumentality/empty").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Nothing is here.");
    expect(res.text).toContain("/css/pages/instrumentality-shadow.css");
    expect(res.text).toContain("/instrumentality/shadow");
  });

  it("serves the hidden Instrumentality apocrypha page from the core", async () => {
    const res = await request(app).get("/instrumentality/apocrypha").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("The Farm After People");
    expect(res.text).toContain("silence as consent");
    expect(res.text).toContain("/instrumentality/core");
  });

  it("serves the hidden Instrumentality Oracle chat page through the Instrumentality namespace", async () => {
    const res = await request(app).get("/instrumentality/chat").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("INSTRUMENTALITY");
    expect(res.text).toContain('id="ishOracleMessages"');
    expect(res.text).toContain("/js/pages/instrumentality-chat.js");
  });

  it("redirects legacy Instrumentality page paths into the Instrumentality namespace", async () => {
    await request(app).get("/instrumentality-shadow").expect(302).expect("Location", "/instrumentality/shadow");
    await request(app).get("/operator/instrumentality-core").expect(302).expect("Location", "/instrumentality/core");
    await request(app).get("/operator/instrumentality-apocrypha.html").expect(302).expect("Location", "/instrumentality/apocrypha");
    await request(app).get("/operator/instrumentality-chat").expect(302).expect("Location", "/instrumentality/chat");
  });

  it("serves .html Instrumentality aliases for compatibility", async () => {
    await request(app).get("/instrumentality/core.html").expect(200);
    await request(app).get("/instrumentality/apocrypha.html").expect(200);
    await request(app).get("/instrumentality/chat.html").expect(200);
  });

  it("reports an empty tally before anything is mirrored", async () => {
    const res = await request(app).get("/instrumentality/shadow?format=json").expect(200);
    expect(res.body).toEqual({ absorbed: 0, since: null, recent: [] });
  });

  it("streams shadow snapshots over SSE when mirrored requests are absorbed", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const controller = new AbortController();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/instrumentality/shadow/stream`, {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body.getReader();
      const initial = await readSseUntil(reader, "snapshot");
      expect(initial).toContain('"absorbed":0');

      await request(app).post("/instrumentality/shadow/v1/sse-probe").expect(204);
      const update = await readSseUntil(reader, "sse-probe");
      expect(update).toContain('"absorbed":1');
      expect(update).toContain('"/v1/sse-probe"');
    } finally {
      controller.abort();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("absorbs a mirrored request of any method and path with 204 and no body", async () => {
    await request(app).post("/instrumentality/shadow/v1/users").send({ any: "payload" }).expect(204);
    await request(app).delete("/instrumentality/shadow/v1/fields/42").expect(204);
    await request(app).get("/instrumentality/shadow/v1/about").expect(204);

    const res = await request(app).get("/instrumentality/shadow?format=json").expect(200);
    expect(res.body.absorbed).toBe(3);
    expect(res.body.since).toBeTruthy();
    // Newest first, and only method/path/time — the mirrored body is discarded.
    expect(res.body.recent.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /v1/about", "DELETE /v1/fields/42", "POST /v1/users"]);
    expect(Object.keys(res.body.recent[0]).sort()).toEqual(["at", "method", "path"]);
  });

  it("keeps only the most recent echoes while still counting every one", async () => {
    const total = shadow.MAX_RECENT + 5;
    for (let i = 0; i < total; i++) {
      await request(app).get(`/instrumentality/shadow/v1/echo/${i}`).expect(204);
    }
    const res = await request(app).get("/instrumentality/shadow?format=json").expect(200);
    expect(res.body.absorbed).toBe(total);
    expect(res.body.recent).toHaveLength(shadow.MAX_RECENT);
    expect(res.body.recent[0].path).toBe(`/v1/echo/${total - 1}`);
  });

  it("aims the Instrumentality preset's mirror at this app's own port, not a fixed one", async () => {
    const res = await request(app).get("/api/v1/chaos-engine").expect(200);
    const { targetUrl } = res.body.data.previewConfigs.instrumentality.mirroring;
    const port = process.env.PORT || 3000;
    expect(targetUrl).toBe(`http://127.0.0.1:${port}/instrumentality/shadow`);

    // Mirroring appends the original request path, so the target must be the sink
    // (which discards) rather than an API root (which would re-run the write).
    await request(app)
      .put(`${new URL(targetUrl).pathname}/v1/users/7`)
      .send({ mirrored: true })
      .expect(204);
    const tally = await request(app).get("/instrumentality/shadow?format=json").expect(200);
    expect(tally.body.recent[0]).toMatchObject({ method: "PUT", path: "/v1/users/7" });
  });

  describe("absorb() unit tests", () => {
    it("increments the absorbed counter and returns it", () => {
      expect(shadow.absorb()).toBe(1);
      expect(shadow.absorb()).toBe(2);
      expect(shadow.absorb()).toBe(3);
    });

    it("uses default method 'GET' and path '/' when not provided", () => {
      shadow.absorb();
      const snap = shadow.snapshot();
      expect(snap.recent[0]).toMatchObject({ method: "GET", path: "/" });
    });

    it("uppercases the method", () => {
      shadow.absorb({ method: "post" });
      shadow.absorb({ method: "pUt" });
      shadow.absorb({ method: "delete" });
      const snap = shadow.snapshot();
      expect(snap.recent.map((e) => e.method)).toEqual(["DELETE", "PUT", "POST"]);
    });

    it("truncates method to 10 characters", () => {
      shadow.absorb({ method: "X".repeat(15) });
      const snap = shadow.snapshot();
      expect(snap.recent[0].method).toBe("X".repeat(10));
    });

    it("truncates path to MAX_PATH_LEN characters", () => {
      const longPath = "/api/" + "x".repeat(200);
      shadow.absorb({ path: longPath });
      const snap = shadow.snapshot();
      expect(snap.recent[0].path).toHaveLength(120);
      expect(snap.recent[0].path).toBe(longPath.slice(0, 120));
    });

    it("uses provided timestamp or generates one", () => {
      const customTime = "2026-08-05T10:00:00.000Z";
      shadow.absorb({ at: customTime });
      const snap = shadow.snapshot();
      expect(snap.recent[0].at).toBe(customTime);
    });

    it("sets 'since' on the first call only", () => {
      const t1 = "2026-08-05T10:00:00.000Z";
      const t2 = "2026-08-05T11:00:00.000Z";
      shadow.absorb({ at: t1 });
      shadow.absorb({ at: t2 });
      const snap = shadow.snapshot();
      expect(snap.since).toBe(t1);
    });

    it("maintains recent entries in newest-first order", () => {
      shadow.absorb({ method: "GET", path: "/first" });
      shadow.absorb({ method: "POST", path: "/second" });
      shadow.absorb({ method: "PUT", path: "/third" });
      const snap = shadow.snapshot();
      expect(snap.recent.map((e) => e.path)).toEqual(["/third", "/second", "/first"]);
    });

    it("caps recent entries at MAX_RECENT", () => {
      for (let i = 0; i < shadow.MAX_RECENT + 10; i++) {
        shadow.absorb({ path: `/path/${i}` });
      }
      const snap = shadow.snapshot();
      expect(snap.recent).toHaveLength(shadow.MAX_RECENT);
      expect(snap.absorbed).toBe(shadow.MAX_RECENT + 10);
      expect(snap.recent[0].path).toBe(`/path/${shadow.MAX_RECENT + 9}`);
    });

    it("excludes the body and returns only method, path, and timestamp in snapshot", () => {
      shadow.absorb({ method: "POST", path: "/users" });
      const snap = shadow.snapshot();
      expect(Object.keys(snap.recent[0]).sort()).toEqual(["at", "method", "path"]);
    });
  });
});

async function readSseUntil(reader, needle) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 2000;

  while (!text.includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for SSE frame containing ${needle}. Received: ${text}`);
    }
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out reading SSE stream")), 500)),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }

  return text;
}
