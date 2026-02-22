const { WebSocketServer, WebSocket } = require("ws");
const { URL } = require("url");
const messengerService = require("./messenger.service");
const messengerEventsService = require("./messenger-events.service");
const featureFlagsService = require("./feature-flags.service");
const { isUserLogged, getUserId } = require("../helpers/token.helpers");
const { logDebug, logInfo } = require("../helpers/logger-api");

const WS_PATH = "/api/v1/messages/ws";
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_MESSAGE_RATE_PER_MIN = 240;
const MAX_UPGRADES_PER_MIN_PER_IP = 120;

class MessengerWebSocketService {
  constructor() {
    this.wss = null;
    this.userSockets = new Map();
    this.connectionMeta = new WeakMap();
    this.heartbeatTimer = null;
    this.upgradeAttemptsByIp = new Map();
    this.relationshipChangedListener = (eventPayload) => {
      this._handleRelationshipChangedEvent(eventPayload);
    };
    this.messagesReadListener = (eventPayload) => {
      this._handleMessagesReadEvent(eventPayload);
    };
  }

  attach(server) {
    if (!server) {
      throw new Error("Server instance is required");
    }

    if (this.wss) {
      return this.wss;
    }

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 16 * 1024,
    });

    this.wss.on("connection", (socket, request, context = {}) => {
      this._handleConnection(socket, request, context);
    });

    server.on("upgrade", async (request, socket, head) => {
      const isMessengerPath = (request.url || "").startsWith(WS_PATH);
      if (!isMessengerPath) {
        return;
      }

      try {
        const context = await this._authenticateUpgrade(request);

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request, context);
        });
      } catch (error) {
        this._rejectUpgrade(socket, error?.statusCode || 401, error?.message || "Unauthorized");
      }
    });

    this.heartbeatTimer = setInterval(() => this._heartbeatSweep(), HEARTBEAT_INTERVAL_MS);
    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }

    messengerEventsService.onRelationshipChanged(this.relationshipChangedListener);
    messengerEventsService.onMessagesRead(this.messagesReadListener);

    logInfo("Messenger WebSocket gateway attached", { path: WS_PATH });
    return this.wss;
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.userSockets.clear();
    this.connectionMeta = new WeakMap();
    this.upgradeAttemptsByIp.clear();
    messengerEventsService.offRelationshipChanged(this.relationshipChangedListener);
    messengerEventsService.offMessagesRead(this.messagesReadListener);
  }

  _handleRelationshipChangedEvent(eventPayload = {}) {
    const userIds = Array.isArray(eventPayload.userIds) ? eventPayload.userIds : [];
    if (userIds.length === 0) {
      return;
    }

    for (const userId of userIds) {
      this._sendToUser(userId, {
        type: "friends_updated",
        data: {
          reason: eventPayload.reason || "relationship_updated",
          actorUserId: Number(eventPayload.actorUserId) || null,
          targetUserId: Number(eventPayload.targetUserId) || null,
          occurredAt: eventPayload.occurredAt || new Date().toISOString(),
        },
      });
    }
  }

  _handleMessagesReadEvent(eventPayload = {}) {
    const readByUserId = Number(eventPayload.readByUserId);
    const withUserId = Number(eventPayload.withUserId);

    if (!Number.isInteger(readByUserId) || readByUserId <= 0 || !Number.isInteger(withUserId) || withUserId <= 0) {
      return;
    }

    // Send read status update to the user whose messages were read
    this._sendToUser(withUserId, {
      type: "read_status_updated",
      data: {
        readByUserId,
        occurredAt: eventPayload.occurredAt || new Date().toISOString(),
      },
    });
  }

  _heartbeatSweep() {
    if (!this.wss) {
      return;
    }

    for (const socket of this.wss.clients) {
      const meta = this.connectionMeta.get(socket);
      if (!meta) {
        continue;
      }

      if (meta.isAlive === false) {
        socket.terminate();
        continue;
      }

      meta.isAlive = false;
      socket.ping();
    }
  }

  _trackUpgradeAttempt(ip) {
    const now = Date.now();
    const history = this.upgradeAttemptsByIp.get(ip) || [];
    const recent = history.filter((timestamp) => now - timestamp <= 60000);
    recent.push(now);
    this.upgradeAttemptsByIp.set(ip, recent);
    return recent.length;
  }

  _rejectUpgrade(socket, statusCode, message) {
    try {
      socket.write(
        `HTTP/1.1 ${statusCode} ${message}\r\n` + "Connection: close\r\n" + "Content-Type: text/plain\r\n" + "\r\n" + `${message}`,
      );
    } catch (error) {
      // ignore write failures
    }
    try {
      socket.destroy();
    } catch (error) {
      // ignore destroy failures
    }
  }

  _extractToken(request) {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.slice("Bearer ".length).trim();
    }

    const host = request.headers.host || "localhost";
    const parsed = new URL(request.url || WS_PATH, `http://${host}`);

    const tokenFromQuery = parsed.searchParams.get("token");
    if (tokenFromQuery) {
      return tokenFromQuery;
    }

    const cookieHeader = request.headers.cookie || "";
    const cookies = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);

    for (const entry of cookies) {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const name = entry.slice(0, separatorIndex);
      const value = entry.slice(separatorIndex + 1);
      if (name === "rolnopolToken") {
        return decodeURIComponent(value || "");
      }
    }

    return null;
  }

  _isOriginAllowed(request) {
    const originHeader = request.headers.origin;
    if (!originHeader) {
      return true;
    }

    const host = request.headers.host;
    if (!host) {
      return false;
    }

    try {
      const origin = new URL(originHeader);
      if (origin.host === host) {
        return true;
      }

      const localhostHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
      return localhostHosts.has(origin.hostname) && localhostHosts.has(host.split(":")[0]);
    } catch (error) {
      return false;
    }
  }

  async _authenticateUpgrade(request) {
    const ip = request.socket?.remoteAddress || request.headers["x-forwarded-for"] || "unknown";
    const attempts = this._trackUpgradeAttempt(String(ip));

    if (attempts > MAX_UPGRADES_PER_MIN_PER_IP) {
      const error = new Error("Too many websocket connection attempts");
      error.statusCode = 429;
      throw error;
    }

    if (!this._isOriginAllowed(request)) {
      const error = new Error("Origin not allowed");
      error.statusCode = 403;
      throw error;
    }

    const flags = await featureFlagsService.getFeatureFlags();
    if (flags?.flags?.messengerEnabled !== true) {
      const error = new Error("Messenger not found");
      error.statusCode = 404;
      throw error;
    }

    const token = this._extractToken(request);
    if (!token) {
      const error = new Error("Access token required");
      error.statusCode = 401;
      throw error;
    }

    if (!isUserLogged(token)) {
      const error = new Error("Invalid or expired token");
      error.statusCode = 403;
      throw error;
    }

    const userId = Number(getUserId(token));
    if (!Number.isInteger(userId) || userId <= 0) {
      const error = new Error("Invalid token format");
      error.statusCode = 403;
      throw error;
    }

    return {
      userId,
      token,
      ip,
    };
  }

  _safeSend(socket, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      logDebug("WebSocket send failed", { error: error.message });
    }
  }

  _registerSocketForUser(userId, socket) {
    const sockets = this.userSockets.get(userId) || new Set();
    sockets.add(socket);
    this.userSockets.set(userId, sockets);
  }

  _unregisterSocketForUser(userId, socket) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.userSockets.delete(userId);
    }
  }

  _broadcastToUsers(userIds, payload) {
    for (const userId of userIds) {
      const sockets = this.userSockets.get(Number(userId));
      if (!sockets) {
        continue;
      }

      for (const socket of sockets) {
        this._safeSend(socket, payload);
      }
    }
  }

  _sendToUser(userId, payload) {
    const sockets = this.userSockets.get(Number(userId));
    if (!sockets) {
      return;
    }

    for (const socket of sockets) {
      this._safeSend(socket, payload);
    }
  }

  async _assertMessengerEnabled(socket) {
    const flags = await featureFlagsService.getFeatureFlags();
    if (flags?.flags?.messengerEnabled !== true) {
      this._safeSend(socket, {
        type: "error",
        error: "Messenger not found",
        code: 404,
      });
      socket.close(4404, "Messenger disabled");
      return false;
    }

    return true;
  }

  _validateRateLimit(socket) {
    const meta = this.connectionMeta.get(socket);
    if (!meta) {
      return true;
    }

    const now = Date.now();
    meta.messageTimestamps = meta.messageTimestamps.filter((timestamp) => now - timestamp <= 60000);
    meta.messageTimestamps.push(now);

    if (meta.messageTimestamps.length > MAX_MESSAGE_RATE_PER_MIN) {
      this._safeSend(socket, {
        type: "error",
        error: "Too many websocket messages",
        code: 429,
      });
      socket.close(4429, "Rate limit exceeded");
      return false;
    }

    return true;
  }

  _handleConnection(socket, _request, context) {
    const userId = Number(context.userId);
    const token = context.token;

    this.connectionMeta.set(socket, {
      userId,
      token,
      isAlive: true,
      messageTimestamps: [],
    });

    this._registerSocketForUser(userId, socket);

    socket.on("pong", () => {
      const meta = this.connectionMeta.get(socket);
      if (meta) {
        meta.isAlive = true;
      }
    });

    socket.on("message", async (rawData, isBinary) => {
      if (isBinary) {
        this._safeSend(socket, {
          type: "error",
          error: "Binary websocket payloads are not supported",
          code: 400,
        });
        return;
      }

      if (!this._validateRateLimit(socket)) {
        return;
      }

      let packet;
      try {
        packet = JSON.parse(rawData.toString("utf8"));
      } catch (error) {
        this._safeSend(socket, {
          type: "error",
          error: "Invalid websocket payload",
          code: 400,
        });
        return;
      }

      await this._handleIncomingPacket(socket, packet);
    });

    socket.on("close", () => {
      this._unregisterSocketForUser(userId, socket);
      this.connectionMeta.delete(socket);
    });

    socket.on("error", (error) => {
      logDebug("Messenger websocket connection error", { error: error?.message, userId });
    });

    this._safeSend(socket, {
      type: "connected",
      data: {
        userId,
        serverTime: new Date().toISOString(),
      },
    });
  }

  async _handleIncomingPacket(socket, packet) {
    const meta = this.connectionMeta.get(socket);
    if (!meta) {
      return;
    }

    if (!isUserLogged(meta.token)) {
      this._safeSend(socket, {
        type: "error",
        error: "Invalid or expired token",
        code: 403,
      });
      socket.close(4401, "Unauthorized");
      return;
    }

    if (!(await this._assertMessengerEnabled(socket))) {
      return;
    }

    const type = packet?.type;
    const payload = packet?.payload || {};

    if (type === "ping") {
      this._safeSend(socket, {
        type: "pong",
        data: {
          serverTime: new Date().toISOString(),
        },
      });
      return;
    }

    if (type === "subscribe") {
      try {
        const withUserId = payload.withUserId;
        const since = payload.since;
        const result = await messengerService.pollMessages(meta.userId, withUserId, since);

        this._safeSend(socket, {
          type: "conversation_delta",
          data: {
            withUser: result.withUser,
            blocked: result.blocked,
            unread: result.unread,
            messages: result.messages,
            cursor: result.cursor,
          },
        });
      } catch (error) {
        this._safeSend(socket, {
          type: "error",
          error: error.message || "Unable to subscribe conversation",
          code: this._resolveStatusCode(error),
        });
      }
      return;
    }

    if (type === "send_message") {
      try {
        const sent = await messengerService.sendMessage(meta.userId, {
          toUserId: payload.toUserId,
          content: payload.content,
        });

        this._safeSend(socket, {
          type: "message_sent",
          data: sent,
          clientMessageId: payload.clientMessageId || null,
        });

        this._sendToUser(sent.fromUserId, {
          type: "message_new",
          data: sent,
        });

        this._sendToUser(sent.toUserId, {
          type: "message_new",
          data: {
            ...sent,
            status: "unread",
          },
        });
      } catch (error) {
        this._safeSend(socket, {
          type: "error",
          error: error.message || "Unable to send message",
          code: this._resolveStatusCode(error),
          clientMessageId: payload.clientMessageId || null,
        });
      }
      return;
    }

    this._safeSend(socket, {
      type: "error",
      error: "Unsupported websocket message type",
      code: 400,
    });
  }

  _resolveStatusCode(error) {
    if (!error || !error.message) {
      return 500;
    }

    if (error.message.includes("Validation failed")) return 400;
    if (error.message.includes("forbidden") || error.message.includes("blocked")) return 403;
    if (error.message.includes("not found")) return 404;
    if (error.message.includes("deactivated")) return 401;
    return 500;
  }
}

module.exports = new MessengerWebSocketService();
