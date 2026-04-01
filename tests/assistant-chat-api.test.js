import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

process.env.CHATBOT_LLM_PROVIDER = "mock";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setAssistantChatEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { assistantChatEnabled: enabled } })
    .expect(200);
}

async function registerUser(suffix) {
  const credentials = {
    email: `assistant-chat-${suffix}-${Date.now()}@test.com`,
    displayedName: `assistant_${suffix}`,
    password: "testpass123",
  };

  const registerRes = await request(app).post("/api/v1/register").send(credentials).expect(201);

  return {
    token: registerRes.body?.data?.token,
    userId: registerRes.body?.data?.user?.id,
    credentials,
  };
}

describe("Assistant chat API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when assistant chat feature flag is disabled", async () => {
    const user = await registerUser("disabled");
    await setAssistantChatEnabled(false);

    const res = await request(app)
      .post("/api/v1/assistant-chat/messages")
      .set("token", user.token)
      .send({ message: "summary" })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it("returns 401 when feature is enabled but user is not authenticated", async () => {
    await setAssistantChatEnabled(true);

    const res = await request(app).post("/api/v1/assistant-chat/messages").send({ message: "summary" }).expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Access token required");
  });

  it("returns mocked assistant response with authenticated user-scoped summary", async () => {
    await setAssistantChatEnabled(true);

    const userA = await registerUser("user-a");
    const userB = await registerUser("user-b");

    await request(app)
      .post("/api/v1/fields")
      .set("token", userA.token)
      .send({ name: "North Field", area: 12.5, districtName: "North District" })
      .expect(201);

    await request(app)
      .post("/api/v1/staff")
      .set("token", userA.token)
      .send({ name: "Anna", surname: "Kowalska", position: "Agronomist", age: 31 })
      .expect(201);

    await request(app).post("/api/v1/animals").set("token", userA.token).send({ type: "cow", amount: 10 }).expect(201);

    await request(app)
      .post("/api/v1/fields")
      .set("token", userB.token)
      .send({ name: "Foreign Field", area: 99, districtName: "Other District" })
      .expect(201);

    const res = await request(app)
      .post("/api/v1/assistant-chat/messages")
      .set("token", userA.token)
      .send({ message: "summary for my fields staff and animals" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("provider", "mock");
    expect(res.body.data).toHaveProperty("reply");
    expect(res.body.data.contextSummary).toMatchObject({
      fieldsCount: 1,
      staffCount: 1,
      animalRecordsCount: 1,
      totalAnimals: 10,
    });
  });

  it("returns easter egg response for secret prompt", async () => {
    await setAssistantChatEnabled(true);
    const user = await registerUser("easter-egg");

    const res = await request(app)
      .post("/api/v1/assistant-chat/messages")
      .set("token", user.token)
      .send({ message: "follow-the-red-rain" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.reply).toContain("Red rain protocol acknowledged");
  });

  it("returns minimal reply for very short messages without loading context", async () => {
    await setAssistantChatEnabled(true);
    const user = await registerUser("short-msg");

    const res = await request(app).post("/api/v1/assistant-chat/messages").set("token", user.token).send({ message: "hi" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.reply).toContain("Ask me about your fields, staff, animals");
    expect(res.body.data.contextSummary).toBeNull(); // No context loaded for short messages
  });
});
