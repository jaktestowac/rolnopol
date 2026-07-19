import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

process.env.CHATBOT_LLM_PROVIDER = "mock";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setFlags(flags) {
  await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
}

async function registerUser(suffix) {
  const safeSuffix = String(suffix || "user")
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 8);

  const credentials = {
    email: `porky-stream-${safeSuffix}-${Date.now()}@test.com`,
    displayedName: `pky_${safeSuffix}`,
    password: "testpass123",
  };

  const registerRes = await request(app).post("/api/v1/register").send(credentials).expect(201);

  return {
    token: registerRes.body?.data?.token,
    userId: registerRes.body?.data?.user?.id,
  };
}

/**
 * Parse a buffered SSE response body into an ordered list of { event, data }.
 * The mock provider closes the stream, so supertest hands us the whole body.
 */
function parseSse(text) {
  const events = [];
  const blocks = text.split(/\n\n/);
  for (const block of blocks) {
    const lines = block.split(/\n/);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    if (dataLines.length > 0) {
      let data = {};
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch (error) {
        data = { raw: dataLines.join("\n") };
      }
      events.push({ event, data });
    }
  }
  return events;
}

describe("Assistant chat streaming API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when assistant chat is disabled", async () => {
    const user = await registerUser("off");
    await setFlags({ assistantChatEnabled: false });

    const res = await request(app)
      .post("/api/v1/assistant-chat/stream")
      .set("token", user.token)
      .send({ message: "summary of my farm" })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it("returns 401 when enabled but the user is not authenticated", async () => {
    await setFlags({ assistantChatEnabled: true });

    const res = await request(app).post("/api/v1/assistant-chat/stream").send({ message: "summary of my farm" }).expect(401);

    expect(res.body.success).toBe(false);
  });

  it("streams a mocked reply as start → token(s) → done", async () => {
    await setFlags({ assistantChatEnabled: true });
    const user = await registerUser("stream");

    const res = await request(app)
      .post("/api/v1/assistant-chat/stream")
      .set("token", user.token)
      .send({ message: "give me a summary of my farm" })
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseSse(res.text);
    const types = events.map((e) => e.event);

    expect(types[0]).toBe("start");
    expect(types).toContain("token");
    expect(types[types.length - 1]).toBe("done");

    const start = events.find((e) => e.event === "start");
    expect(start.data).toHaveProperty("provider", "mock");
    expect(start.data).toHaveProperty("botId", "farm-assistant");

    // The concatenated token deltas must reconstruct the final reply.
    const tokenText = events
      .filter((e) => e.event === "token")
      .map((e) => e.data.delta)
      .join("");
    const done = events.find((e) => e.event === "done");
    expect(done.data.reply).toBe(tokenText);
    expect(done.data.reply.length).toBeGreaterThan(0);
  });

  it("emits the minimal reply as a single token for very short messages", async () => {
    await setFlags({ assistantChatEnabled: true });
    const user = await registerUser("short");

    const res = await request(app).post("/api/v1/assistant-chat/stream").set("token", user.token).send({ message: "hi" }).expect(200);

    const events = parseSse(res.text);
    const done = events.find((e) => e.event === "done");
    expect(done.data.reply).toContain("Ask me about your fields");
    expect(done.data.contextSummary).toBeNull();
  });
});
