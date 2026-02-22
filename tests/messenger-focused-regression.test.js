import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

/**
 * Focused Messenger Service Regression Tests
 *
 * Tests critical functionality while avoiding rate limiting:
 * - Reuses test users across multiple tests
 * - Groups tests by scenario to minimize user creation
 * - Focuses on high-impact regression scenarios
 */

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

async function createAndLoginUser(displayedName = "User") {
  const email = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "pass123Test!";
  await request(app).post("/api/v1/register").send({ email, password, displayedName }).expect(201);
  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);
  return { token: loginRes.body?.data?.token, user: loginRes.body?.data?.user };
}

describe("Messenger Service - Focused Regression Tests", () => {
  let originalFlags;
  let alice, bob, charlie;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await setMessengerEnabled(true);

    // Create test users once, reuse across tests
    alice = await createAndLoginUser("Alice");
    bob = await createAndLoginUser("Bob");
    charlie = await createAndLoginUser("Charlie");
  });

  afterAll(async () => {
    if (originalFlags) {
      try {
        await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
      } catch (err) {
        // Ignore rate limit on cleanup
      }
    }
  });

  describe("Critical: Message Status Derivation", () => {
    it("sender sees 'delivered' status for unread message", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Status test 1" })
        .expect(201);

      expect(res.body.data.status).toBe("delivered");
    });

    it("sender sees 'read' after recipient reads message", async () => {
      // Send message
      const sendRes = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Status test 2 - read verify" })
        .expect(201);

      const msgId = sendRes.body.data.id;

      // Bob reads conversation (auto-marks as read)
      await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      // Alice fetches and verifies status changed to read
      const convRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      const message = convRes.body.data.messages.find((m) => Number(m.id) === Number(msgId));
      expect(message).toBeDefined();
      expect(message.status).toBe("read");
    });

    it("recipient sees 'unread' status for incoming message", async () => {
      // Get conversation list before sending
      const beforeRes = await request(app).get("/api/v1/messages/conversations").set("token", charlie.token).expect(200);

      const beforeUnread = beforeRes.body.data.reduce((sum, c) => sum + c.unreadCount, 0);

      // Alice sends to Charlie (don't read)
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: charlie.user.id, content: "Unread test message" })
        .expect(201);

      // Get conversation list after
      const afterRes = await request(app).get("/api/v1/messages/conversations").set("token", charlie.token).expect(200);

      const aliceConv = afterRes.body.data.find((c) => c.withUser.id === alice.user.id);
      expect(aliceConv).toBeDefined();
      expect(aliceConv.unreadCount).toBeGreaterThan(0);
    });
  });

  describe("Critical: Unread Count Accuracy", () => {
    it("unread count resets to zero after reading", async () => {
      // Alice sends message to Bob
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Unread count reset test" })
        .expect(201);

      // Bob reads conversation
      const convRes = await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      expect(convRes.body.data.unread.withUser).toBe(0);
      expect(convRes.body.data.unread.total).toBe(0);
    });

    it("per-conversation unread counts are accurate", async () => {
      // Clear out messages by reading them
      await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);
      await request(app).get(`/api/v1/messages/conversations/${charlie.user.id}`).set("token", bob.token).expect(200);

      // Alice sends 3 messages to Bob
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Count test ${i}` })
          .expect(201);
      }

      // Charlie sends 1 message to Bob
      await request(app)
        .post("/api/v1/messages")
        .set("token", charlie.token)
        .send({ toUserId: bob.user.id, content: "Charlie message" })
        .expect(201);

      // Bob gets conversation list
      const convRes = await request(app).get("/api/v1/messages/conversations").set("token", bob.token).expect(200);

      const aliceConv = convRes.body.data.find((c) => c.withUser.id === alice.user.id);
      const charlieConv = convRes.body.data.find((c) => c.withUser.id === charlie.user.id);

      expect(aliceConv.unreadCount).toBe(3);
      expect(charlieConv.unreadCount).toBe(1);
    });
  });

  describe("Critical: Pagination", () => {
    it("respects limit parameter", async () => {
      // Create 2 messages
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Pagination test 1" })
        .expect(201);

      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Pagination test 2" })
        .expect(201);

      // Fetch with limit=1
      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=1`).set("token", alice.token).expect(200);

      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.messages.length).toBeLessThanOrEqual(1);
    });

    it("returns hasMore flag correctly", async () => {
      // Create 3 messages
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `More test ${i}` })
          .expect(201);
      }

      // Fetch with limit=1
      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=1`).set("token", alice.token).expect(200);

      expect(res.body.data.pagination.hasMore).toBe(true);
    });

    it("respects 'since' cursor in poll", async () => {
      // Send 2 messages
      const msg1 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Since cursor test 1" })
        .expect(201);

      const msg2 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Since cursor test 2" })
        .expect(201);

      // Poll with since=first message ID
      const pollRes = await request(app)
        .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=${msg1.body.data.id}`)
        .set("token", alice.token)
        .expect(200);

      // Should only get message after msg1
      const ids = pollRes.body.data.messages.map((m) => Number(m.id));
      expect(ids.every((id) => id > msg1.body.data.id)).toBe(true);
    });
  });

  describe("Critical: Concurrent Operations", () => {
    it("concurrent sends produce unique IDs without collision", async () => {
      // Send 10 messages concurrently
      const sendPromises = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Concurrent ${i}` })
          .expect(201),
      );

      const results = await Promise.all(sendPromises);
      const ids = results.map((r) => Number(r.body.data.id));

      // Verify all unique (no collisions)
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);

      // Verify all IDs are positive integers
      expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);

      // Fetch conversation and verify all messages present in order
      const convRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=100`)
        .set("token", alice.token)
        .expect(200);

      const messages = convRes.body.data.messages;
      const foundIds = messages.map((m) => Number(m.id));

      // All sent IDs should be present
      const foundSet = new Set(foundIds);
      expect(ids.every((id) => foundSet.has(id))).toBe(true);

      // And messages should be in order
      for (let i = 1; i < foundIds.length; i++) {
        expect(foundIds[i]).toBeGreaterThanOrEqual(foundIds[i - 1]);
      }
    });

    it("concurrent reads don't interfere", async () => {
      // Send message
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Concurrent read test" })
        .expect(201);

      // Bob and Alice both read concurrently
      const [bobRes, aliceRes] = await Promise.all([
        request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token),
        request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token),
      ]);

      expect(bobRes.status).toBe(200);
      expect(aliceRes.status).toBe(200);
      expect(Array.isArray(bobRes.body.data.messages)).toBe(true);
      expect(Array.isArray(aliceRes.body.data.messages)).toBe(true);
    });
  });

  describe("Critical: Content Validation", () => {
    it("rejects empty message", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/required|empty/i);
    });

    it("rejects message exceeding max length", async () => {
      const longContent = "x".repeat(1025);

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: longContent })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/exceed|length/i);
    });

    it("accepts message at max length boundary", async () => {
      const maxContent = "x".repeat(1024);

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: maxContent })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content.length).toBeLessThanOrEqual(1024);
    });
  });

  describe("Critical: User Validation", () => {
    it("prevents self-message", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: alice.user.id, content: "Self message" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/yourself|self/i);
    });

    it("prevents message to non-existent user", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: 999999, content: "To nobody" })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found|exist/i);
    });

    it("rejects invalid user ID format", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: "invalid", content: "To invalid" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("Critical: Blocking Behavior", () => {
    it("prevents send when blocked by recipient", async () => {
      // Get fresh unblocked state
      const newUser1 = await createAndLoginUser("User1");
      const newUser2 = await createAndLoginUser("User2");

      // User2 blocks User1
      await request(app).post("/api/v1/users/blocked").set("token", newUser2.token).send({ userId: newUser1.user.id }).expect(201);

      // User1 tries to send to User2
      const sendRes = await request(app)
        .post("/api/v1/messages")
        .set("token", newUser1.token)
        .send({ toUserId: newUser2.user.id, content: "Should block" })
        .expect(403);

      expect(sendRes.body.success).toBe(false);
      expect(sendRes.body.error).toMatch(/forbidden|blocked/i);
    });

    it("shows block status in conversation fetch", async () => {
      // Fresh users
      const newUser3 = await createAndLoginUser("User3");
      const newUser4 = await createAndLoginUser("User4");

      // User3 blocks User4
      await request(app).post("/api/v1/users/blocked").set("token", newUser3.token).send({ userId: newUser4.user.id }).expect(201);

      // User3 fetches conversation
      const convRes = await request(app).get(`/api/v1/messages/conversations/${newUser4.user.id}`).set("token", newUser3.token).expect(200);

      expect(convRes.body.data.blocked.blockedByYou).toBe(true);
    });
  });

  describe("Critical: Message Ordering", () => {
    it("messages returned in chronological order", async () => {
      // Send 3 messages with delays
      const sentIds = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Order test ${i}` })
          .expect(201);
        sentIds.push(Number(res.body.data.id));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Fetch conversation
      const convRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=100`)
        .set("token", alice.token)
        .expect(200);

      // Verify order
      const messages = convRes.body.data.messages;
      for (let i = 1; i < messages.length; i++) {
        const prevTime = new Date(messages[i - 1].createdAt).getTime();
        const currTime = new Date(messages[i].createdAt).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });

    it("conversation list shows consistent last message", async () => {
      // Ensure Alice has conversations with Bob and Charlie
      const msg1 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Message to Bob" })
        .expect(201);

      const msg2 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: charlie.user.id, content: "Message to Charlie" })
        .expect(201);

      // Get conversation list
      const convRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);

      const conversations = convRes.body.data;
      const charlieConv = conversations.find((c) => c.withUser.id === charlie.user.id);
      const bobConv = conversations.find((c) => c.withUser.id === bob.user.id);

      // Both conversations should be present with correct last message
      expect(charlieConv).toBeDefined();
      expect(bobConv).toBeDefined();
      expect(charlieConv.lastMessage.id).toBeDefined();
      expect(bobConv.lastMessage.id).toBeDefined();
    });
  });

  describe("Critical: Response Structure", () => {
    it("message response includes all required fields", async () => {
      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Structure test" })
        .expect(201);

      const msg = res.body.data;
      expect(msg.id).toBeDefined();
      expect(msg.fromUserId).toBe(alice.user.id);
      expect(msg.toUserId).toBe(bob.user.id);
      expect(msg.content).toBe("Structure test");
      expect(msg.createdAt).toBeDefined();
      expect(["delivered", "read", "unread"]).toContain(msg.status);
    });

    it("conversation response includes all required fields", async () => {
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Conv structure" })
        .expect(201);

      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      const conv = res.body.data;
      expect(conv.withUser).toBeDefined();
      expect(conv.blocked).toBeDefined();
      expect(conv.unread).toBeDefined();
      expect(conv.pagination).toBeDefined();
      expect(Array.isArray(conv.messages)).toBe(true);
    });
  });
});
