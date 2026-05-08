import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.CHATBOT_LLM_PROVIDER = "mock";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setAlertsAssistantFlags({ alertsEnabled = true, alertsAiAssistantEnabled = false } = {}) {
  await request(app).patch("/api/v1/feature-flags").send({ flags: { alertsEnabled, alertsAiAssistantEnabled } }).expect(200);
}

describe("Alerts chat API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when alerts AI assistant flag is disabled", async () => {
    await setAlertsAssistantFlags({ alertsEnabled: true, alertsAiAssistantEnabled: false });

    const res = await request(app)
      .post("/api/v1/alerts-chat/messages")
      .send({ message: "what stands out today?", region: "PL-14", date: "2026-05-08" })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it("returns a short helper reply for very short prompts", async () => {
    await setAlertsAssistantFlags({ alertsEnabled: true, alertsAiAssistantEnabled: true });

    const res = await request(app).post("/api/v1/alerts-chat/messages").send({ message: "hi", region: "PL-14" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.botId).toBe("alerts-guide");
    expect(res.body.data.botName).toBe("Alerticus");
    expect(res.body.data.reply).toContain("Ask me about today's alerts");
  });

  it("answers alerts questions using alerts snapshot context", async () => {
    await setAlertsAssistantFlags({ alertsEnabled: true, alertsAiAssistantEnabled: true });

    const res = await request(app)
      .post("/api/v1/alerts-chat/messages")
      .send({ message: "What looks urgent today?", region: "PL-14", date: "2026-05-08" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.botId).toBe("alerts-guide");
    expect(res.body.data.contextSummary).toBe("alerts-overview");
    expect(typeof res.body.data.reply).toBe("string");
    expect(res.body.data.reply.length).toBeGreaterThan(20);
  });
});
