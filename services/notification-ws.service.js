const { WebSocketServer, WebSocket } = require("ws");
const { URL } = require("url");
const notificationCenter = require("../modules/notification-center");
const featureFlagsService = require("./feature-flags.service");
const tokenHelpers = require("../helpers/token.helpers");
const { logDebug, logInfo } = require("../helpers/logger-api");

const WS_PATH = "/api/v1/notifications/ws";
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_MESSAGE_RATE_PER_MIN = 120;
const MAX_UPGRADES_PER_MIN_PER_IP = 120;

class NotificationWebSocketService {
  constructor() {
    this.wss = null;
    this.adminSockets = new Set();
    this.userSockets = new Map();
    this.connectionMeta = new WeakMap();
    this.heartbeatTimer = null;
    this.upgradeAttemptsByIp = new Map();
    this.unsubscribeRealtime = null;
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
      const isNotificationPath = (request.url || "").startsWith(WS_PATH);
      if (!isNotificationPath) {
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

    this.unsubscribeRealtime = notificationCenter.subscribeRealtime((packet) => {
      this._handleRealtimePacket(packet);
    });

    logInfo("Notification WebSocket gateway attached", { path: WS_PATH });
    return this.wss;
  }

  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (typeof this.unsubscribeRealtime === "function") {
      this.unsubscribeRealtime();
      this.unsubscribeRealtime = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.adminSockets.clear();
    this.userSockets.clear();
    this.connectionMeta = new WeakMap();
    this.upgradeAttemptsByIp.clear();
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
    } catch {
      // ignore write failures
    }

    try {
      socket.destroy();
    } catch {
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

      if (name === "krakenToken" || name === "rolnopolToken") {
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
    } catch {
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
    if (flags?.flags?.notificationCenterEnabled !== true) {
      const error = new Error("Notification center not found");
      error.statusCode = 404;
      throw error;
    }

    const token = this._extractToken(request);
    if (!token) {
      const error = new Error("Access token required");
      error.statusCode = 401;
      throw error;
    }

    if (tokenHelpers.isAdminToken(token)) {
      return {
        role: "admin",
        userId: "kraken-admin",
        token,
        ip,
      };
    }

    if (!tokenHelpers.isUserLogged(token)) {
      const error = new Error("Invalid or expired token");
      error.statusCode = 403;
      throw error;
    }

    const userId = Number(tokenHelpers.getUserId(token));
    if (!Number.isInteger(userId) || userId <= 0) {
      const error = new Error("Invalid token format");
      error.statusCode = 403;
      throw error;
    }

    return {
      role: "user",
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
      logDebug("Notification websocket send failed", { error: error.message });
    }
  }

  _registerSocket(meta, socket) {
    if (meta.role === "admin") {
      this.adminSockets.add(socket);
      return;
    }

    const sockets = this.userSockets.get(meta.userId) || new Set();
    sockets.add(socket);
    this.userSockets.set(meta.userId, sockets);
  }

  _unregisterSocket(meta, socket) {
    if (!meta) {
      return;
    }

    if (meta.role === "admin") {
      this.adminSockets.delete(socket);
      return;
    }

    const sockets = this.userSockets.get(meta.userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.userSockets.delete(meta.userId);
    }
  }

  async _assertNotificationCenterEnabled(socket) {
    const flags = await featureFlagsService.getFeatureFlags();
    if (flags?.flags?.notificationCenterEnabled !== true) {
      this._safeSend(socket, {
        type: "error",
        error: "Notification center not found",
        code: 404,
      });
      socket.close(4404, "Notification center disabled");
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
    const meta = {
      ...context,
      isAlive: true,
      messageTimestamps: [],
    };

    this.connectionMeta.set(socket, meta);
    this._registerSocket(meta, socket);

    socket.on("pong", () => {
      const currentMeta = this.connectionMeta.get(socket);
      if (currentMeta) {
        currentMeta.isAlive = true;
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
      } catch {
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
      this._unregisterSocket(meta, socket);
      this.connectionMeta.delete(socket);
    });

    socket.on("error", (error) => {
      logDebug("Notification websocket connection error", {
        error: error?.message,
        role: meta.role,
        userId: meta.userId,
      });
    });

    this._safeSend(socket, {
      type: "connected",
      data: {
        role: meta.role,
        userId: meta.userId,
        serverTime: new Date().toISOString(),
      },
    });
  }

  async _handleIncomingPacket(socket, packet) {
    const meta = this.connectionMeta.get(socket);
    if (!meta) {
      return;
    }

    if (!(await this._assertNotificationCenterEnabled(socket))) {
      return;
    }

    if (meta.role === "admin") {
      if (!tokenHelpers.isAdminToken(meta.token)) {
        this._safeSend(socket, {
          type: "error",
          error: "Invalid or expired admin token",
          code: 403,
        });
        socket.close(4401, "Unauthorized");
        return;
      }
    } else if (!tokenHelpers.isUserLogged(meta.token)) {
      this._safeSend(socket, {
        type: "error",
        error: "Invalid or expired token",
        code: 403,
      });
      socket.close(4401, "Unauthorized");
      return;
    }

    if (packet?.type === "ping") {
      this._safeSend(socket, {
        type: "pong",
        data: {
          serverTime: new Date().toISOString(),
        },
      });
      return;
    }

    this._safeSend(socket, {
      type: "error",
      error: "Unsupported websocket message type",
      code: 400,
    });
  }

  _broadcastToAdmins(payload) {
    for (const socket of this.adminSockets) {
      this._safeSend(socket, payload);
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

  _handleRealtimePacket(packet = {}) {
    const payload = {
      type: "notification_center_update",
      data: {
        entity: packet.entity || "unknown",
        action: packet.action || "updated",
        record: packet.record || null,
        occurredAt: packet.occurredAt || new Date().toISOString(),
        channel: packet.channel || null,
        channelStatus: packet.channelStatus || null,
      },
    };

    this._broadcastToAdmins(payload);

    if (packet.entity !== "notification") {
      return;
    }

    const userId = Number(packet.record?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return;
    }

    this._sendToUser(userId, payload);
  }
}

const notificationWebSocketService = new NotificationWebSocketService();

module.exports = notificationWebSocketService;
module.exports.NotificationWebSocketService = NotificationWebSocketService;
module.exports.WS_PATH = WS_PATH;
