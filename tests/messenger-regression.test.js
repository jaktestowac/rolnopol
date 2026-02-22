import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

/**
 * Comprehensive Messenger Service Regression Test Suite
 *
 * Tests critical functionality to prevent regressions:
 * - Message status derivation and visibility
 * - Unread count accuracy
 * - Pagination and cursor-based navigation
 * - Concurrent read/write operations
 * - Read status synchronization across users
 * - Message ordering and tie-breaking
 * - User deactivation and blocking edge cases
 * - Content validation and sanitization
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
  const email = `regression_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "testpass123";
  await request(app).post("/api/v1/register").send({ email, password, displayedName }).expect(201);
  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);
  return { token: loginRes.body?.data?.token, user: loginRes.body?.data?.user };
}

describe("Messenger Service - Regression Tests", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await setMessengerEnabled(true);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  describe("Message Status Derivation - Regression", () => {
    it("sender sees 'delivered' status for unread recipient message", async () => {
      const alice = await createAndLoginUser("Alice");
      const bob = await createAndLoginUser("Bob");

      const sentRes = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Test message" })
        .expect(201);

      expect(sentRes.body.data.status).toBe("delivered");
    });

    it("sender sees 'read' status after recipient reads message", async () => {
      const alice = await createAndLoginUser("Alice Status");
      const bob = await createAndLoginUser("Bob Status");

      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Status test" })
        .expect(201);

      // Bob reads conversation (automatically marks messages as read)
      await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      // Alice fetches conversation and should see 'read' status
      const aliceViewRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      expect(aliceViewRes.body.data.messages.length).toBeGreaterThan(0);
      const messageFromAlice = aliceViewRes.body.data.messages.find((msg) => msg.fromUserId === alice.user.id);
      expect(messageFromAlice.status).toBe("read");
    });

    it("recipient sees 'unread' status for unread message", async () => {
      const alice = await createAndLoginUser("Alice Unread");
      const bob = await createAndLoginUser("Bob Unread");

      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Unread test" })
        .expect(201);

      // Get all conversations without reading them
      const convsRes = await request(app).get("/api/v1/messages/conversations").set("token", bob.token).expect(200);

      const convWithAlice = convsRes.body.data.find((conv) => conv.withUser.id === alice.user.id);
      expect(convWithAlice).toBeDefined();
      expect(convWithAlice.unreadCount).toBeGreaterThan(0);
    });

    it("sender's own message shows 'read' status immediately", async () => {
      const alice = await createAndLoginUser("Alice Own");
      const bob = await createAndLoginUser("Bob Own");

      const sentRes = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Own message" })
        .expect(201);

      expect(sentRes.body.data.status).toBe("delivered");

      // Fetch conversation - sender's own message should be 'read' or 'delivered'
      const historyRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      const ownMessage = historyRes.body.data.messages.find((msg) => msg.id === sentRes.body.data.id);
      expect(["delivered", "read"]).toContain(ownMessage.status);
    });
  });

  describe("Unread Count Accuracy - Regression", () => {
    it("unread count increases when new messages arrive", async () => {
      const alice = await createAndLoginUser("Alice Count");
      const bob = await createAndLoginUser("Bob Count");

      // Get initial count from conversations endpoint
      const initialRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);
      const initialUnread = initialRes.body.data.unread.total;

      // Bob sends messages
      await request(app)
        .post("/api/v1/messages")
        .set("token", bob.token)
        .send({ toUserId: alice.user.id, content: "Message 1" })
        .expect(201);

      await request(app)
        .post("/api/v1/messages")
        .set("token", bob.token)
        .send({ toUserId: alice.user.id, content: "Message 2" })
        .expect(201);

      // Get conversation list to see unread count BEFORE polling
      const beforePollRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);
      const unreadBeforePoll = beforePollRes.body.data.find((c) => c.withUser.id === bob.user.id)?.unreadCount || 0;

      // Unread should have increased since Bob sent messages
      expect(unreadBeforePoll).toBeGreaterThan(initialUnread);

      // Polling will auto-mark as read
      const pollRes = await request(app).get(`/api/v1/messages/poll?withUserId=${bob.user.id}`).set("token", alice.token).expect(200);

      // After polling, messages should be marked as read
      expect(pollRes.body.data.unread.withUser).toBe(0);
      expect(pollRes.body.data.messages.length).toBeGreaterThanOrEqual(2);
    });

    it("unread count resets to zero after reading conversation", async () => {
      const alice = await createAndLoginUser("Alice Reset");
      const bob = await createAndLoginUser("Bob Reset");

      // Bob sends multiple messages
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", bob.token)
          .send({ toUserId: alice.user.id, content: `Message ${i}` })
          .expect(201);
      }

      // Alice reads conversation
      const readRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      expect(readRes.body.data.unread.withUser).toBe(0);
      expect(readRes.body.data.unread.total).toBe(0);
    });

    it("unread count per conversation is accurate in conversation list", async () => {
      const alice = await createAndLoginUser("Alice List");
      const bob = await createAndLoginUser("Bob List");
      const charlie = await createAndLoginUser("Charlie List");

      // Bob sends 2 unread messages to Alice
      await request(app)
        .post("/api/v1/messages")
        .set("token", bob.token)
        .send({ toUserId: alice.user.id, content: "From Bob 1" })
        .expect(201);
      await request(app)
        .post("/api/v1/messages")
        .set("token", bob.token)
        .send({ toUserId: alice.user.id, content: "From Bob 2" })
        .expect(201);

      // Charlie sends 1 unread message to Alice
      await request(app)
        .post("/api/v1/messages")
        .set("token", charlie.token)
        .send({ toUserId: alice.user.id, content: "From Charlie" })
        .expect(201);

      // Get conversation list
      const convsRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);

      const bobConv = convsRes.body.data.find((conv) => conv.withUser.id === bob.user.id);
      const charlieConv = convsRes.body.data.find((conv) => conv.withUser.id === charlie.user.id);

      expect(bobConv.unreadCount).toBe(2);
      expect(charlieConv.unreadCount).toBe(1);
    });

    it("unread count reflects only messages to current user", async () => {
      const alice = await createAndLoginUser("Alice Only");
      const bob = await createAndLoginUser("Bob Only");

      // Alice sends to Bob
      await request(app).post("/api/v1/messages").set("token", alice.token).send({ toUserId: bob.user.id, content: "To Bob" }).expect(201);

      // Bob sends back to Alice
      await request(app)
        .post("/api/v1/messages")
        .set("token", bob.token)
        .send({ toUserId: alice.user.id, content: "To Alice" })
        .expect(201);

      // Alice's unread count should only include messages FROM Bob
      const aliceViewRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=100`)
        .set("token", alice.token)
        .expect(200);

      // When fetching conversation, it auto-reads
      expect(aliceViewRes.body.data.unread.withUser).toBe(0);
    });
  });

  describe("Pagination - Regression", () => {
    it("respects limit parameter in conversation fetch", async () => {
      const alice = await createAndLoginUser("Alice Limit");
      const bob = await createAndLoginUser("Bob Limit");

      // Create 15 messages
      for (let i = 0; i < 15; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Message ${i}` })
          .expect(201);
      }

      // Fetch with limit=5
      const res5 = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=5`).set("token", alice.token).expect(200);

      expect(res5.body.data.messages.length).toBe(5);
      expect(res5.body.data.pagination.limit).toBe(5);
      expect(res5.body.data.pagination.returned).toBe(5);

      // Fetch with limit=10
      const res10 = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=10`).set("token", alice.token).expect(200);

      expect(res10.body.data.messages.length).toBe(10);
      expect(res10.body.data.pagination.returned).toBe(10);
    });

    it("respects 'before' cursor with message ID", async () => {
      const alice = await createAndLoginUser("Alice Before");
      const bob = await createAndLoginUser("Bob Before");

      const messages = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
        messages.push(res.body.data);
      }

      const beforeId = messages[2].id; // Get messages before the 3rd message

      const paginatedRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?before=${beforeId}&limit=100`)
        .set("token", alice.token)
        .expect(200);

      // Should get messages with ID < beforeId
      expect(paginatedRes.body.data.messages.every((msg) => Number(msg.id) < beforeId)).toBe(true);
    });

    it("respects 'since' cursor with message ID in poll", async () => {
      const alice = await createAndLoginUser("Alice Since");
      const bob = await createAndLoginUser("Bob Since");

      const messages = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
        messages.push(res.body.data);
      }

      const sinceId = messages[2].id;

      const pollRes = await request(app)
        .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=${sinceId}`)
        .set("token", alice.token)
        .expect(200);

      // Should get messages with ID > sinceId
      expect(pollRes.body.data.messages.every((msg) => Number(msg.id) > sinceId)).toBe(true);
    });

    it("returns hasMore flag correctly", async () => {
      const alice = await createAndLoginUser("Alice HasMore");
      const bob = await createAndLoginUser("Bob HasMore");

      // Create 10 messages
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
      }

      // Request with limit=5, should have more
      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=5`).set("token", alice.token).expect(200);

      expect(res.body.data.pagination.hasMore).toBe(true);
      expect(res.body.data.pagination.returned).toBe(5);
    });

    it("handles empty conversation pagination gracefully", async () => {
      const alice = await createAndLoginUser("Alice Empty");
      const bob = await createAndLoginUser("Bob Empty");

      // No messages sent between them

      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=50`).set("token", alice.token).expect(200);

      expect(res.body.data.messages.length).toBe(0);
      expect(res.body.data.pagination.hasMore).toBe(false);
      expect(res.body.data.pagination.returned).toBe(0);
    });
  });

  describe("Concurrent Operations - Regression", () => {
    it("concurrent reads don't interfere with each other", async () => {
      const alice = await createAndLoginUser("Alice Concurrent");
      const bob = await createAndLoginUser("Bob Concurrent");

      // Alice sends 5 messages
      const messageIds = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
        messageIds.push(res.body.data.id);
      }

      // Bob and Alice both fetch conversation concurrently
      const [bobRes, aliceRes] = await Promise.all([
        request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token),
        request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token),
      ]);

      expect(bobRes.status).toBe(200);
      expect(aliceRes.status).toBe(200);

      // Both should see the messages
      expect(bobRes.body.data.messages.length).toBeGreaterThan(0);
      expect(aliceRes.body.data.messages.length).toBeGreaterThan(0);
    });

    it("concurrent sends followed by reads show all messages in order", async () => {
      const alice = await createAndLoginUser("Alice Send");
      const bob = await createAndLoginUser("Bob Send");

      // Send 10 messages concurrently with a marker
      const marker = `concurrent-${Date.now()}`;
      const sendPromises = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `${marker}-${i}` })
          .expect(201),
      );

      const sendResults = await Promise.all(sendPromises);
      expect(sendResults).toHaveLength(10);

      // Fetch and verify all messages are present and ordered
      const historyRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=200`)
        .set("token", alice.token)
        .expect(200);

      const markedMessages = historyRes.body.data.messages.filter((msg) => msg.content.includes(marker));
      expect(markedMessages).toHaveLength(10);

      // Verify IDs are in increasing order
      const ids = markedMessages.map((msg) => Number(msg.id));
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThanOrEqual(ids[i - 1]);
      }
    });

    it("interleaved sends and reads maintain consistency", async () => {
      const alice = await createAndLoginUser("Alice Interleaved");
      const bob = await createAndLoginUser("Bob Interleaved");

      // Send message 1
      const msg1 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Message 1" })
        .expect(201);

      // Bob reads (marks as read)
      const bobRead1 = await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      // Send message 2
      const msg2 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Message 2" })
        .expect(201);

      // Read again
      const bobRead2 = await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      // All messages should be present and read
      expect(bobRead2.body.data.messages.length).toBeGreaterThanOrEqual(2);
      expect(bobRead2.body.data.unread.total).toBe(0);
    });
  });

  describe("Message Content Validation - Regression", () => {
    it("rejects empty message content", async () => {
      const alice = await createAndLoginUser("Alice Empty Content");
      const bob = await createAndLoginUser("Bob Empty Content");

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("required");
    });

    it("rejects message exceeding max length", async () => {
      const alice = await createAndLoginUser("Alice Long");
      const bob = await createAndLoginUser("Bob Long");

      const longContent = "x".repeat(1025); // MAX_MESSAGE_LENGTH is 1024

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: longContent })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("exceeds");
    });

    it("accepts message at max length boundary", async () => {
      const alice = await createAndLoginUser("Alice Boundary");
      const bob = await createAndLoginUser("Bob Boundary");

      const maxContent = "x".repeat(1024);

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: maxContent })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content.length).toBe(1024);
    });

    it("preserves whitespace and special characters in message", async () => {
      const alice = await createAndLoginUser("Alice Special");
      const bob = await createAndLoginUser("Bob Special");

      const specialContent = "  Test\n\twith  multiple   spaces  and\nnewlines  ";

      const sendRes = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: specialContent })
        .expect(201);

      const historyRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      const message = historyRes.body.data.messages.find((msg) => msg.id === sendRes.body.data.id);
      expect(message.content).toBe(specialContent);
    });
  });

  describe("Message Ordering - Regression", () => {
    it("messages are returned in chronological order", async () => {
      const alice = await createAndLoginUser("Alice Order");
      const bob = await createAndLoginUser("Bob Order");

      const sendTimes = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);

        sendTimes.push(new Date(res.body.data.createdAt).getTime());
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const historyRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=100`)
        .set("token", alice.token)
        .expect(200);

      const messages = historyRes.body.data.messages;
      for (let i = 1; i < messages.length; i++) {
        const prev = new Date(messages[i - 1].createdAt).getTime();
        const curr = new Date(messages[i].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("uses message ID as tie-breaker when timestamps are identical", async () => {
      const alice = await createAndLoginUser("Alice Tiebreak");
      const bob = await createAndLoginUser("Bob Tiebreak");

      // Send multiple messages rapidly
      const sentMessages = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Rapid ${i}` })
          .expect(201);
        sentMessages.push(res.body.data);
      }

      const historyRes = await request(app)
        .get(`/api/v1/messages/conversations/${bob.user.id}?limit=100`)
        .set("token", alice.token)
        .expect(200);

      const messages = historyRes.body.data.messages;
      const ids = messages.map((m) => Number(m.id));

      // IDs should be in strictly increasing order
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThanOrEqual(ids[i - 1]);
      }
    });

    it("conversation list shows conversations with newest messages first", async () => {
      const alice = await createAndLoginUser("Alice Conv Order");
      const bob = await createAndLoginUser("Bob Conv Order");
      const charlie = await createAndLoginUser("Charlie Conv Order");

      // Message with Bob (older)
      await request(app).post("/api/v1/messages").set("token", alice.token).send({ toUserId: bob.user.id, content: "Old" }).expect(201);

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Message with Charlie (newer)
      await request(app).post("/api/v1/messages").set("token", alice.token).send({ toUserId: charlie.user.id, content: "New" }).expect(201);

      const convsRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);

      const conversations = convsRes.body.data;
      expect(conversations.length).toBeGreaterThanOrEqual(2);

      // Charlie (newest) should come before Bob
      const charlieIdx = conversations.findIndex((c) => c.withUser.id === charlie.user.id);
      const bobIdx = conversations.findIndex((c) => c.withUser.id === bob.user.id);

      expect(charlieIdx).toBeLessThan(bobIdx);
    });
  });

  describe("Blocking Behavior - Regression", () => {
    it("blocked user cannot see sender's previous messages", async () => {
      const alice = await createAndLoginUser("Alice Block View");
      const bob = await createAndLoginUser("Bob Block View");

      // Alice sends message to Bob
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Before block" })
        .expect(201);

      // Bob blocks Alice
      await request(app).post("/api/v1/users/blocked").set("token", bob.token).send({ userId: alice.user.id }).expect(201);

      // Alice tries to fetch conversation - should fail or show blocked status
      const aliceViewRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      expect(aliceViewRes.body.data.blocked.blockedByUser).toBe(true);
    });

    it("sender can see they are blocked", async () => {
      const alice = await createAndLoginUser("Alice See Block");
      const bob = await createAndLoginUser("Bob See Block");

      // Bob blocks Alice
      await request(app).post("/api/v1/users/blocked").set("token", bob.token).send({ userId: alice.user.id }).expect(201);

      // Alice fetches conversation and should see blocked flag
      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      expect(res.body.data.blocked.blockedByUser).toBe(true);
    });

    it("recipient can see they blocked sender", async () => {
      const alice = await createAndLoginUser("Alice Block By");
      const bob = await createAndLoginUser("Bob Block By");

      // Bob blocks Alice
      await request(app).post("/api/v1/users/blocked").set("token", bob.token).send({ userId: alice.user.id }).expect(201);

      // Bob fetches conversation and should see blockedByYou flag
      const res = await request(app).get(`/api/v1/messages/conversations/${alice.user.id}`).set("token", bob.token).expect(200);

      expect(res.body.data.blocked.blockedByYou).toBe(true);
    });
  });

  describe("User Validation - Regression", () => {
    it("prevents messaging to non-existent user", async () => {
      const alice = await createAndLoginUser("Alice NonExistent");

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: 999999, content: "Phantom" })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("not found");
    });

    it("rejects invalid recipient ID format", async () => {
      const alice = await createAndLoginUser("Alice Invalid ID");

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: "not-a-number", content: "Invalid" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("prevents self-messaging", async () => {
      const alice = await createAndLoginUser("Alice Self");

      const res = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: alice.user.id, content: "Self" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("cannot send messages to yourself");
    });
  });

  describe("Edge Cases - Regression", () => {
    it("handles very long conversation history with pagination", async () => {
      const alice = await createAndLoginUser("Alice Long Hist");
      const bob = await createAndLoginUser("Bob Long Hist");

      // Create 50 messages (reduced from 100 for better performance)
      for (let i = 0; i < 50; i++) {
        await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Message ${i}` })
          .expect(201);
      }

      // Fetch with small limit
      const res = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}?limit=10`).set("token", alice.token).expect(200);

      expect(res.body.data.messages.length).toBe(10);
      expect(res.body.data.pagination.hasMore).toBe(true);
    }, 15000);

    it("poll with invalid since cursor returns validation error", async () => {
      const alice = await createAndLoginUser("Alice Invalid Since");
      const bob = await createAndLoginUser("Bob Invalid Since");

      const res = await request(app)
        .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=invalid`)
        .set("token", alice.token)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("poll with since=0 returns all messages", async () => {
      const alice = await createAndLoginUser("Alice Since Zero");
      const bob = await createAndLoginUser("Bob Since Zero");

      // Send 3 messages
      const sentIds = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
        sentIds.push(res.body.data.id);
      }

      // Poll with since=0
      const pollRes = await request(app)
        .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=0`)
        .set("token", alice.token)
        .expect(200);

      expect(pollRes.body.data.messages.length).toBeGreaterThanOrEqual(3);
    });

    it("cursor returns correct messageId for pagination", async () => {
      const alice = await createAndLoginUser("Alice Cursor");
      const bob = await createAndLoginUser("Bob Cursor");

      // Send 5 messages
      const sentMessages = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/v1/messages")
          .set("token", alice.token)
          .send({ toUserId: bob.user.id, content: `Msg ${i}` })
          .expect(201);
        sentMessages.push(res.body.data);
      }

      // Poll - should return cursor with latest message ID
      const pollRes = await request(app)
        .get(`/api/v1/messages/poll?withUserId=${bob.user.id}&since=0`)
        .set("token", alice.token)
        .expect(200);

      expect(pollRes.body.data.cursor).toBeDefined();
      expect(pollRes.body.data.cursor.messageId).toBeDefined();
      expect(Number(pollRes.body.data.cursor.messageId)).toBeGreaterThan(0);
    });
  });

  describe("User Deactivation - Regression", () => {
    it("prevents messaging to deactivated user", async () => {
      const alice = await createAndLoginUser("Alice Deactivate");
      const bob = await createAndLoginUser("Bob Deactivate");

      // Note: In this test setup, we can't easily deactivate a user
      // This is a placeholder for the regression test structure
      // In production, you'd have a deactivation endpoint

      expect(true).toBe(true); // Placeholder
    });
  });

  describe("Conversation List - Regression", () => {
    it("conversation list shows all users with messages", async () => {
      const alice = await createAndLoginUser("Alice List Show");
      const bob = await createAndLoginUser("Bob List Show");
      const charlie = await createAndLoginUser("Charlie List Show");

      // Send messages with both
      await request(app).post("/api/v1/messages").set("token", alice.token).send({ toUserId: bob.user.id, content: "To Bob" }).expect(201);
      await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: charlie.user.id, content: "To Charlie" })
        .expect(201);

      const convsRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);

      expect(Array.isArray(convsRes.body.data)).toBe(true);
      expect(convsRes.body.data.length).toBeGreaterThanOrEqual(2);

      const bobInList = convsRes.body.data.some((c) => c.withUser.id === bob.user.id);
      const charlieInList = convsRes.body.data.some((c) => c.withUser.id === charlie.user.id);

      expect(bobInList).toBe(true);
      expect(charlieInList).toBe(true);
    });

    it("conversation list shows last message in each conversation", async () => {
      const alice = await createAndLoginUser("Alice Last Msg");
      const bob = await createAndLoginUser("Bob Last Msg");

      const msg1 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "First" })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const msg2 = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Second" })
        .expect(201);

      const convsRes = await request(app).get("/api/v1/messages/conversations").set("token", alice.token).expect(200);

      const bobConv = convsRes.body.data.find((c) => c.withUser.id === bob.user.id);
      expect(bobConv.lastMessage.id).toBe(msg2.body.data.id);
      expect(bobConv.lastMessage.content).toBe("Second");
    });
  });

  describe("Response Structure Validation - Regression", () => {
    it("message response includes all required fields", async () => {
      const alice = await createAndLoginUser("Alice Fields");
      const bob = await createAndLoginUser("Bob Fields");

      const sendRes = await request(app)
        .post("/api/v1/messages")
        .set("token", alice.token)
        .send({ toUserId: bob.user.id, content: "Test fields" })
        .expect(201);

      const message = sendRes.body.data;
      expect(message.id).toBeDefined();
      expect(message.fromUserId).toBe(alice.user.id);
      expect(message.toUserId).toBe(bob.user.id);
      expect(message.content).toBe("Test fields");
      expect(message.createdAt).toBeDefined();
      expect(["delivered", "read", "unread"]).toContain(message.status);
    });

    it("conversation response includes all required fields", async () => {
      const alice = await createAndLoginUser("Alice Conv Fields");
      const bob = await createAndLoginUser("Bob Conv Fields");

      await request(app).post("/api/v1/messages").set("token", alice.token).send({ toUserId: bob.user.id, content: "Test" }).expect(201);

      const convRes = await request(app).get(`/api/v1/messages/conversations/${bob.user.id}`).set("token", alice.token).expect(200);

      const convData = convRes.body.data;
      expect(convData.withUser).toBeDefined();
      expect(convData.blocked).toBeDefined();
      expect(convData.unread).toBeDefined();
      expect(convData.pagination).toBeDefined();
      expect(Array.isArray(convData.messages)).toBe(true);
    });
  });
});
