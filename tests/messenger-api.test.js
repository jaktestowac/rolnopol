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

async function createAndLoginUser(displayedName = "Messenger User") {
  const email = `messenger_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "testpass123";

  await request(app).post("/api/v1/register").send({ email, password, displayedName }).expect(201);

  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);

  return {
    token: loginRes.body?.data?.token,
    user: loginRes.body?.data?.user,
  };
}

describe("Messenger API FR-4/FR-5", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 for messaging endpoints when messenger feature flag is disabled", async () => {
    await setMessengerEnabled(false);

    const res = await request(app).get("/api/v1/messages/conversations").expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Messenger not found");
  });

  it("blocks and unblocks user by identifier with list endpoints", async () => {
    await setMessengerEnabled(true);

    const alice = await createAndLoginUser("Alice");
    const bob = await createAndLoginUser("Bob");

    const blockRes = await request(app)
      .post("/api/v1/users/blocked")
      .set("token", alice.token)
      .send({ identifier: bob.user.email })
      .expect(201);

    expect(blockRes.body.success).toBe(true);
    expect(blockRes.body.data.blockedUser.id).toBe(bob.user.id);

    const listRes = await request(app).get("/api/v1/users/blocked").set("token", alice.token).expect(200);

    expect(listRes.body.success).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.some((item) => item.id === bob.user.id)).toBe(true);

    await request(app).delete(`/api/v1/users/blocked/${bob.user.id}`).set("token", alice.token).expect(200);

    const listAfter = await request(app).get("/api/v1/users/blocked").set("token", alice.token).expect(200);
    expect(listAfter.body.data.some((item) => item.id === bob.user.id)).toBe(false);
  });

  it("prevents self-block and duplicate block", async () => {
    await setMessengerEnabled(true);

    const user = await createAndLoginUser("SelfBlock User");

    const selfBlockRes = await request(app)
      .post("/api/v1/users/blocked")
      .set("token", user.token)
      .send({ userId: user.user.id })
      .expect(400);

    expect(selfBlockRes.body.success).toBe(false);
    expect(selfBlockRes.body.error).toContain("cannot block yourself");

    await request(app).post("/api/v1/users/blocked").set("token", user.token).send({ identifier: "demo" }).expect(201);

    const duplicateRes = await request(app).post("/api/v1/users/blocked").set("token", user.token).send({ identifier: "demo" }).expect(409);

    expect(duplicateRes.body.success).toBe(false);
    expect(duplicateRes.body.error).toContain("already");
  });

  it("sends message, fetches conversation history, and polls incrementally", async () => {
    await setMessengerEnabled(true);

    const alice = await createAndLoginUser("Sender");
    const bob = await createAndLoginUser("Receiver");

    const sentOne = await request(app)
      .post("/api/v1/messages")
      .set("token", alice.token)
      .send({ toUserId: bob.user.id, content: "Hello Bob" })
      .expect(201);

    expect(sentOne.body.success).toBe(true);
    expect(sentOne.body.data.fromUserId).toBe(alice.user.id);

    await request(app).post("/api/v1/messages").set("token", bob.token).send({ toUserId: alice.user.id, content: "Hi Alice" }).expect(201);

    const historyRes = await request(app)
      .get(`/api/v1/messages/conversations/${bob.user.id}?limit=50`)
      .set("token", alice.token)
      .expect(200);

    expect(historyRes.body.success).toBe(true);
    expect(Array.isArray(historyRes.body.data.messages)).toBe(true);
    expect(historyRes.body.data.messages.length).toBeGreaterThanOrEqual(2);

    const latestKnownId = historyRes.body.data.messages[historyRes.body.data.messages.length - 1].id;

    await request(app)
      .post("/api/v1/messages")
      .set("token", bob.token)
      .send({ toUserId: alice.user.id, content: "New update" })
      .expect(201);

    const pollRes = await request(app)
      .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=${latestKnownId}`)
      .set("token", alice.token)
      .expect(200);

    expect(pollRes.body.success).toBe(true);
    expect(Array.isArray(pollRes.body.data.messages)).toBe(true);
    expect(pollRes.body.data.messages.length).toBe(1);
    expect(pollRes.body.data.messages[0].content).toBe("New update");
  });

  it("prevents sending message when either user is blocked", async () => {
    await setMessengerEnabled(true);

    const alice = await createAndLoginUser("Alice Blocked Flow");
    const bob = await createAndLoginUser("Bob Blocked Flow");

    await request(app).post("/api/v1/users/blocked").set("token", bob.token).send({ userId: alice.user.id }).expect(201);

    const blockedRes = await request(app)
      .post("/api/v1/messages")
      .set("token", alice.token)
      .send({ toUserId: bob.user.id, content: "Can you see this?" })
      .expect(403);

    expect(blockedRes.body.success).toBe(false);
    expect(blockedRes.body.error).toContain("forbidden");
  });

  it("rejects invalid messaging requests (self and non-existent user)", async () => {
    await setMessengerEnabled(true);

    const user = await createAndLoginUser("Validation User");

    await request(app).post("/api/v1/messages").set("token", user.token).send({ toUserId: user.user.id, content: "self" }).expect(400);

    await request(app).post("/api/v1/messages").set("token", user.token).send({ toUserId: 999999, content: "nobody" }).expect(404);
  });
});
