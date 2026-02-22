const dbManager = require("../data/database-manager");
const UserDataSingleton = require("../data/user-data-singleton");
const { sanitizeString } = require("../helpers/validators");
const messengerEventsService = require("./messenger-events.service");

const MAX_MESSAGE_LENGTH = 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

class MessengerService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
    this.messagesDb = dbManager.getMessagesDatabase();
    this.messageStoreMutationQueue = Promise.resolve();
  }

  _withMessageStoreLock(operation) {
    const run = this.messageStoreMutationQueue.then(() => operation());
    this.messageStoreMutationQueue = run.catch(() => undefined);
    return run;
  }

  _normalizeIdList(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const normalized = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    return [...new Set(normalized)];
  }

  async _getActiveUserOrThrow(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isActive) {
      throw new Error("Account is deactivated");
    }

    return user;
  }

  _toPublicUserSummary(user) {
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username || null,
      displayedName: user.displayedName || null,
      email: user.email || null,
      isActive: user.isActive === true,
    };
  }

  _messageComparator(a, b) {
    const left = Date.parse(a?.createdAt || 0) || 0;
    const right = Date.parse(b?.createdAt || 0) || 0;

    if (left !== right) {
      return left - right;
    }

    return Number(a?.id || 0) - Number(b?.id || 0);
  }

  _normalizeLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
      return DEFAULT_LIMIT;
    }

    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Validation failed: limit must be a positive integer");
    }

    return Math.min(limit, MAX_LIMIT);
  }

  _parseSinceCursor(rawSince) {
    if (rawSince === undefined || rawSince === null || String(rawSince).trim() === "") {
      return null;
    }

    const text = String(rawSince).trim();

    if (/^\d+$/.test(text)) {
      const messageId = Number(text);
      if (!Number.isInteger(messageId) || messageId < 0) {
        throw new Error("Validation failed: since cursor is invalid");
      }
      return { kind: "messageId", value: messageId };
    }

    const timestamp = Date.parse(text);
    if (Number.isNaN(timestamp)) {
      throw new Error("Validation failed: since cursor must be an ISO date or message id");
    }

    return { kind: "timestamp", value: new Date(timestamp).toISOString() };
  }

  _parseBeforeCursor(rawBefore) {
    if (rawBefore === undefined || rawBefore === null || String(rawBefore).trim() === "") {
      return null;
    }

    const text = String(rawBefore).trim();

    if (/^\d+$/.test(text)) {
      const messageId = Number(text);
      if (!Number.isInteger(messageId) || messageId < 0) {
        throw new Error("Validation failed: before cursor is invalid");
      }
      return { kind: "messageId", value: messageId };
    }

    const timestamp = Date.parse(text);
    if (Number.isNaN(timestamp)) {
      throw new Error("Validation failed: before cursor must be an ISO date or message id");
    }

    return { kind: "timestamp", value: new Date(timestamp).toISOString() };
  }

  _ensureMessageStore(store) {
    if (!store || typeof store !== "object") {
      return { messages: [] };
    }

    if (!Array.isArray(store.messages)) {
      return { ...store, messages: [] };
    }

    return store;
  }

  async _readMessageStore() {
    const store = await this.messagesDb.getAll();
    return this._ensureMessageStore(store);
  }

  async _writeMessageStore(store) {
    const normalized = this._ensureMessageStore(store);
    await this.messagesDb.replaceAll(normalized);
  }

  _isEitherDirectionBlocked(sourceUser, targetUser) {
    const sourceBlockedUsers = this._normalizeIdList(sourceUser.blockedUsers);
    const targetBlockedUsers = this._normalizeIdList(targetUser.blockedUsers);

    return sourceBlockedUsers.includes(targetUser.id) || targetBlockedUsers.includes(sourceUser.id);
  }

  _isBlockedByUser(sourceUser, targetUser) {
    const sourceBlockedUsers = this._normalizeIdList(sourceUser.blockedUsers);
    return sourceBlockedUsers.includes(targetUser.id);
  }

  _normalizeReadBy(message) {
    return this._normalizeIdList(message?.readBy);
  }

  _deriveMessageStatus(message, viewerUserId) {
    const viewer = Number(viewerUserId);
    if (!Number.isInteger(viewer) || viewer <= 0) {
      return "unread";
    }

    const fromUserId = Number(message?.fromUserId);
    const toUserId = Number(message?.toUserId);
    const readBy = this._normalizeReadBy(message);

    if (viewer === toUserId) {
      return readBy.includes(viewer) ? "read" : "unread";
    }

    if (viewer === fromUserId) {
      return readBy.includes(toUserId) ? "read" : "delivered";
    }

    return "unread";
  }

  _toMessageResponse(message, viewerUserId = null) {
    return {
      id: message.id,
      fromUserId: Number(message.fromUserId),
      toUserId: Number(message.toUserId),
      content: message.content,
      createdAt: message.createdAt,
      status: this._deriveMessageStatus(message, viewerUserId),
    };
  }

  _markConversationAsRead(store, currentUserId, withUserId) {
    if (!store || !Array.isArray(store.messages)) {
      return false;
    }

    let changed = false;

    for (const message of store.messages) {
      const fromUserId = Number(message?.fromUserId);
      const toUserId = Number(message?.toUserId);

      if (fromUserId !== Number(withUserId) || toUserId !== Number(currentUserId)) {
        continue;
      }

      const readBy = this._normalizeReadBy(message);
      if (!readBy.includes(Number(currentUserId))) {
        message.readBy = [...readBy, Number(currentUserId)];
        message.readAt = new Date().toISOString();
        changed = true;
      }
    }

    return changed;
  }

  _computeUnreadSummary(store, currentUserId, withUserId = null) {
    const byUserId = new Map();
    let total = 0;

    const messages = Array.isArray(store?.messages) ? store.messages : [];
    for (const message of messages) {
      const toUserId = Number(message?.toUserId);
      const fromUserId = Number(message?.fromUserId);

      if (toUserId !== Number(currentUserId)) {
        continue;
      }

      const readBy = this._normalizeReadBy(message);
      if (readBy.includes(Number(currentUserId))) {
        continue;
      }

      total += 1;
      byUserId.set(fromUserId, (byUserId.get(fromUserId) || 0) + 1);
    }

    return {
      total,
      withUser: Number.isInteger(Number(withUserId)) ? byUserId.get(Number(withUserId)) || 0 : 0,
      byUserId,
    };
  }

  async sendMessage(fromUserId, payload = {}) {
    const sender = await this._getActiveUserOrThrow(fromUserId);

    const toUserId = Number(payload?.toUserId);
    if (!Number.isInteger(toUserId) || toUserId <= 0) {
      throw new Error("Validation failed: toUserId must be a positive integer");
    }

    if (sender.id === toUserId) {
      throw new Error("Validation failed: You cannot send messages to yourself");
    }

    const recipient = await this._getActiveUserOrThrow(toUserId);

    if (this._isEitherDirectionBlocked(sender, recipient)) {
      throw new Error("Messaging forbidden: sender and recipient are blocked");
    }

    const rawContent = payload?.content;
    const sanitizedContent = sanitizeString(typeof rawContent === "string" ? rawContent : "");

    if (!sanitizedContent) {
      throw new Error("Validation failed: message content is required");
    }

    if (sanitizedContent.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Validation failed: message content exceeds ${MAX_MESSAGE_LENGTH} characters`);
    }

    return this._withMessageStoreLock(async () => {
      const store = await this._readMessageStore();
      const existing = Array.isArray(store.messages) ? store.messages : [];
      const maxId = existing.reduce((acc, item) => {
        const candidate = Number(item?.id);
        return Number.isInteger(candidate) && candidate > acc ? candidate : acc;
      }, 0);

      const message = {
        id: maxId + 1,
        fromUserId: sender.id,
        toUserId,
        content: sanitizedContent,
        createdAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        readBy: [sender.id],
      };

      await this._writeMessageStore({ ...store, messages: [...existing, message] });

      return this._toMessageResponse(message, sender.id);
    });
  }

  async getConversation(currentUserId, withUserId, query = {}) {
    const currentUser = await this._getActiveUserOrThrow(currentUserId);

    const targetUserId = Number(withUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new Error("Validation failed: withUserId must be a positive integer");
    }

    if (currentUser.id === targetUserId) {
      throw new Error("Validation failed: withUserId cannot reference current user");
    }

    const targetUser = await this._getActiveUserOrThrow(targetUserId);
    const limit = this._normalizeLimit(query.limit);
    const before = this._parseBeforeCursor(query.before);

    return this._withMessageStoreLock(async () => {
      const store = await this._readMessageStore();
      const didMarkAsRead = this._markConversationAsRead(store, currentUser.id, targetUser.id);
      if (didMarkAsRead) {
        await this._writeMessageStore(store);
        messengerEventsService.emitMessagesRead({
          readByUserId: currentUser.id,
          withUserId: targetUser.id,
        });
      }

      const conversation = store.messages
        .filter((message) => {
          const left = Number(message?.fromUserId);
          const right = Number(message?.toUserId);
          return (left === currentUser.id && right === targetUser.id) || (left === targetUser.id && right === currentUser.id);
        })
        .sort((a, b) => this._messageComparator(a, b));

      let filtered = conversation;

      if (before?.kind === "messageId") {
        filtered = filtered.filter((message) => Number(message.id) < before.value);
      } else if (before?.kind === "timestamp") {
        filtered = filtered.filter((message) => (message?.createdAt || "") < before.value);
      }

      const startIndex = Math.max(filtered.length - limit, 0);
      const paginated = filtered.slice(startIndex).map((message) => this._toMessageResponse(message, currentUser.id));
      const unread = this._computeUnreadSummary(store, currentUser.id, targetUser.id);

      return {
        withUser: this._toPublicUserSummary(targetUser),
        blocked: {
          blockedByYou: this._isBlockedByUser(currentUser, targetUser),
          blockedByUser: this._isBlockedByUser(targetUser, currentUser),
        },
        unread: {
          withUser: unread.withUser,
          total: unread.total,
        },
        pagination: {
          limit,
          returned: paginated.length,
          hasMore: startIndex > 0,
        },
        messages: paginated,
      };
    });
  }

  async pollMessages(currentUserId, withUserId, rawSince) {
    const currentUser = await this._getActiveUserOrThrow(currentUserId);

    const targetUserId = Number(withUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new Error("Validation failed: withUserId must be a positive integer");
    }

    if (currentUser.id === targetUserId) {
      throw new Error("Validation failed: withUserId cannot reference current user");
    }

    const targetUser = await this._getActiveUserOrThrow(targetUserId);
    const since = this._parseSinceCursor(rawSince);

    return this._withMessageStoreLock(async () => {
      const store = await this._readMessageStore();
      const didMarkAsRead = this._markConversationAsRead(store, currentUser.id, targetUser.id);
      if (didMarkAsRead) {
        await this._writeMessageStore(store);
        messengerEventsService.emitMessagesRead({
          readByUserId: currentUser.id,
          withUserId: targetUser.id,
        });
      }

      let messages = store.messages
        .filter((message) => {
          const left = Number(message?.fromUserId);
          const right = Number(message?.toUserId);
          return (left === currentUser.id && right === targetUser.id) || (left === targetUser.id && right === currentUser.id);
        })
        .sort((a, b) => this._messageComparator(a, b));

      if (since?.kind === "messageId") {
        messages = messages.filter((message) => Number(message.id) > since.value);
      } else if (since?.kind === "timestamp") {
        messages = messages.filter((message) => (message?.createdAt || "") > since.value);
      }

      const responseMessages = messages.map((message) => this._toMessageResponse(message, currentUser.id));
      const latestMessage = responseMessages[responseMessages.length - 1] || null;
      const unread = this._computeUnreadSummary(store, currentUser.id, targetUser.id);

      return {
        withUser: this._toPublicUserSummary(targetUser),
        blocked: {
          blockedByYou: this._isBlockedByUser(currentUser, targetUser),
          blockedByUser: this._isBlockedByUser(targetUser, currentUser),
        },
        unread: {
          withUser: unread.withUser,
          total: unread.total,
        },
        messages: responseMessages,
        cursor: latestMessage
          ? {
              messageId: latestMessage.id,
              createdAt: latestMessage.createdAt,
            }
          : null,
      };
    });
  }

  async getConversations(currentUserId) {
    const currentUser = await this._getActiveUserOrThrow(currentUserId);
    const store = await this._readMessageStore();
    const unread = this._computeUnreadSummary(store, currentUser.id);

    const byUserId = new Map();

    const sortedMessages = [...store.messages].sort((a, b) => this._messageComparator(a, b));

    for (const message of sortedMessages) {
      const fromUserId = Number(message?.fromUserId);
      const toUserId = Number(message?.toUserId);

      if (fromUserId !== currentUser.id && toUserId !== currentUser.id) {
        continue;
      }

      const otherUserId = fromUserId === currentUser.id ? toUserId : fromUserId;
      if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
        continue;
      }

      byUserId.set(otherUserId, message);
    }

    const conversations = [];

    for (const [otherUserId, lastMessage] of byUserId.entries()) {
      const otherUser = await this.userDataInstance.findUser(otherUserId);
      if (!otherUser || !otherUser.isActive) {
        continue;
      }

      const blockedByYou = this._isBlockedByUser(currentUser, otherUser);
      const blockedByUser = this._isBlockedByUser(otherUser, currentUser);

      conversations.push({
        withUser: this._toPublicUserSummary(otherUser),
        blocked: {
          blockedByYou,
          blockedByUser,
          isBlocked: blockedByYou || blockedByUser,
        },
        unreadCount: unread.byUserId.get(otherUser.id) || 0,
        lastMessage: this._toMessageResponse(lastMessage, currentUser.id),
      });
    }

    conversations.sort((left, right) => this._messageComparator(right.lastMessage, left.lastMessage));

    return conversations;
  }
}

module.exports = new MessengerService();
