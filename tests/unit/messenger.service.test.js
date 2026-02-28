import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import messengerService from "../../services/messenger.service.js";
const messengerEventsService = require("../../services/messenger-events.service");

const users = {
  1: { id: 1, email: "a@test.dev", isActive: true, blockedUsers: [] },
  2: { id: 2, email: "b@test.dev", isActive: true, blockedUsers: [] },
};

describe("messenger.service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(messengerService, "_withMessageStoreLock").mockImplementation(async (operation) => operation());
    vi.spyOn(messengerService.userDataInstance, "findUser").mockImplementation(async (id) => users[Number(id)] || null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid since cursor in pollMessages", async () => {
    await expect(messengerService.pollMessages(1, 2, "not-a-date")).rejects.toThrow("since cursor must be an ISO date or message id");
  });

  it("marks incoming conversation messages as read and emits read event", async () => {
    const store = {
      messages: [
        {
          id: 1,
          fromUserId: 2,
          toUserId: 1,
          content: "hello",
          createdAt: "2026-02-01T10:00:00.000Z",
          readBy: [2],
        },
      ],
    };

    const replaceSpy = vi.spyOn(messengerService.messagesDb, "replaceAll").mockResolvedValue();
    vi.spyOn(messengerService.messagesDb, "getAll").mockResolvedValue(store);
    const emitSpy = vi.spyOn(messengerEventsService, "emitMessagesRead").mockImplementation(() => {});

    const result = await messengerService.getConversation(1, 2, { limit: 10 });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({ readByUserId: 1, withUserId: 2 });
    expect(result.unread.withUser).toBe(0);
    expect(result.messages[0].status).toBe("read");
  });

  it("supports before cursor by message id", async () => {
    const store = {
      messages: [
        {
          id: 1,
          fromUserId: 1,
          toUserId: 2,
          content: "m1",
          createdAt: "2026-02-01T10:00:00.000Z",
          readBy: [1],
        },
        {
          id: 2,
          fromUserId: 2,
          toUserId: 1,
          content: "m2",
          createdAt: "2026-02-01T10:01:00.000Z",
          readBy: [2],
        },
        {
          id: 3,
          fromUserId: 1,
          toUserId: 2,
          content: "m3",
          createdAt: "2026-02-01T10:02:00.000Z",
          readBy: [1],
        },
      ],
    };

    vi.spyOn(messengerService.messagesDb, "replaceAll").mockResolvedValue();
    vi.spyOn(messengerService.messagesDb, "getAll").mockResolvedValue(store);

    const result = await messengerService.getConversation(1, 2, { limit: 10, before: "3" });

    expect(result.messages.map((m) => m.id)).toEqual([1, 2]);
  });
});
