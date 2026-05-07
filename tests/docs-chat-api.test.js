import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.CHATBOT_LLM_PROVIDER = "mock";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setDocsBotEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { docsAiAssistantEnabled: enabled } })
    .expect(200);
}

describe("Docs chat API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when docs AI assistant flag is disabled", async () => {
    await setDocsBotEnabled(false);

    const res = await request(app).post("/api/v1/docs-chat/messages").send({ message: "system overview" }).expect(404);

    expect(res.body.success).toBe(false);
  });

  it("returns a short helper reply for very short prompts", async () => {
    await setDocsBotEnabled(true);

    const res = await request(app).post("/api/v1/docs-chat/messages").send({ message: "hi" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.botId).toBe("docs-guide");
    expect(res.body.data.botName).toBe("Docsy");
    expect(res.body.data.reply).toContain("Ask me about Rolnopol docs");
  });

  it("answers documentation questions using docs search", async () => {
    await setDocsBotEnabled(true);

    const res = await request(app).post("/api/v1/docs-chat/messages").send({ message: "system guide" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.botId).toBe("docs-guide");
    expect(res.body.data.contextSummary).toBe("docs-search");
    expect(res.body.data.reply).toContain("Documentation search results");
  });
});
