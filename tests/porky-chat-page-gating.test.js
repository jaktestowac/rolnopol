import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setFlags(flags) {
  await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
}

describe("Porky streaming chat HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns a 404 page when assistant chat is disabled", async () => {
    await setFlags({ assistantChatEnabled: false });

    const res = await request(app).get("/porky-chat.html").expect(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the page when assistant chat is enabled", async () => {
    await setFlags({ assistantChatEnabled: true });

    const res = await request(app).get("/porky-chat.html").expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Porky Live Chat - Rolnopol");
    expect(res.text).toContain('id="porkyChatMessages"');
  });

  it("redirects /porky-chat to /porky-chat.html when enabled", async () => {
    await setFlags({ assistantChatEnabled: true });

    const res = await request(app).get("/porky-chat").expect(302);
    expect(res.headers.location).toBe("/porky-chat.html");
  });
});
