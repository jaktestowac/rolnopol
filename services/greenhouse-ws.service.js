/**
 * Greenhouse WebSocket bridge (app side).
 *
 * Browsers can't speak native gRPC, so the dashboard's live feed comes over a
 * WebSocket. This bridge accepts a WS connection, opens a gRPC WatchSensors
 * server-stream against the standalone greenhouse service, and forwards each
 * SensorFrame to the browser as JSON. When the socket closes it cancels the
 * gRPC stream.
 *
 * Path: /api/v1/greenhouse/ws?demoId=<demo-...>
 *   • Identity: a valid session token cookie → user; otherwise the demoId query.
 *   • Gated by the greenhouseControlRoomEnabled feature flag at upgrade time.
 *   • Streams the caller's whole greenhouse set (all slots) each tick.
 */
const { WebSocketServer } = require("ws");
const { URL } = require("url");
const featureFlagsService = require("./feature-flags.service");
const tokenHelpers = require("../helpers/token.helpers");
const { logInfo, logDebug, logError } = require("../helpers/logger-api");

const WS_PATH = "/api/v1/greenhouse/ws";
const DEMO_ID_PATTERN = /^demo-[A-Za-z0-9_-]{6,}$/;

let grpcDependencies = null;
let grpcDependencyError = null;

function getGrpcDependencies() {
  if (grpcDependencies) {
    return grpcDependencies;
  }

  try {
    // Lazy-loading keeps the main application bootable even if gRPC packages
    // are missing or otherwise fail during require().
    // eslint-disable-next-line global-require
    const grpc = require("@grpc/grpc-js");
    // eslint-disable-next-line global-require
    const greenhouseClient = require("../modules/greenhouse/greenhouse-client");
    grpcDependencies = { grpc, greenhouseClient };
    grpcDependencyError = null;
    return grpcDependencies;
  } catch (error) {
    grpcDependencyError = error;
    return null;
  }
}

class GreenhouseWebSocketService {
  constructor() {
    this.wss = null;
    this.disabledReasonLogged = false;
  }

  attach(server) {
    if (!server) throw new Error("Server instance is required");
    if (this.wss) return this.wss;

    if (!getGrpcDependencies()) {
      this._logDisabledReason();
      return null;
    }

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.wss.on("connection", (socket, request, context) => this._handleConnection(socket, context));

    server.on("upgrade", async (request, socket, head) => {
      if (!(request.url || "").startsWith(WS_PATH)) return;
      try {
        const context = await this._authenticateUpgrade(request);
        this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit("connection", ws, request, context));
      } catch (error) {
        const code = error?.statusCode || 401;
        socket.write(`HTTP/1.1 ${code} ${error?.message || "Unauthorized"}\r\n\r\n`);
        socket.destroy();
      }
    });

    logInfo("Greenhouse WebSocket bridge attached", { path: WS_PATH });
    return this.wss;
  }

  close() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  async _authenticateUpgrade(request) {
    const data = await featureFlagsService.getFeatureFlags();
    if (data?.flags?.greenhouseControlRoomEnabled !== true) {
      throw Object.assign(new Error("Not Found"), { statusCode: 404 });
    }

    const url = new URL(request.url, "http://localhost");
    const identity = this._resolveIdentity(request, url);
    if (!identity) throw Object.assign(new Error("identity required"), { statusCode: 401 });

    return { identity };
  }

  _resolveIdentity(request, url) {
    const cookie = request.headers.cookie || "";
    const match = cookie.match(/rolnopolToken=([^;]+)/);
    const token = match ? decodeURIComponent(match[1]) : null;
    if (token && tokenHelpers.isUserLogged(token)) {
      const userId = tokenHelpers.getUserId(token);
      if (userId) return { kind: "user", id: String(userId) };
    }
    const demoId = url.searchParams.get("demoId");
    if (demoId && DEMO_ID_PATTERN.test(demoId)) return { kind: "demo", id: demoId };
    return null;
  }

  _handleConnection(socket, context) {
    const dependencies = getGrpcDependencies();
    if (!dependencies) {
      this._logDisabledReason();
      this._send(socket, { type: "error", message: "Greenhouse live updates are temporarily unavailable" });
      this._closeSocket(socket);
      return;
    }

    const { grpc, greenhouseClient } = dependencies;
    const { identity } = context;
    let stream;
    try {
      stream = greenhouseClient.watchGreenhouses(identity);
    } catch (error) {
      this._send(socket, { type: "error", message: "Failed to open greenhouse stream" });
      this._closeSocket(socket);
      return;
    }

    stream.on("data", (frame) => this._send(socket, { type: "frame", frame }));
    stream.on("error", (error) => {
      const offline = error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.DEADLINE_EXCEEDED;
      this._send(socket, {
        type: "error",
        code: error.code,
        offline,
        message: offline ? "Greenhouse service offline — run `npm run greenhouse`" : error.details || "stream error",
      });
      this._closeSocket(socket);
    });
    stream.on("end", () => this._closeSocket(socket));

    const cancel = () => {
      try {
        stream.cancel();
      } catch {
        /* ignore */
      }
    };
    socket.on("close", cancel);
    socket.on("error", cancel);

    logDebug("Greenhouse WS connection opened", { identityKind: identity.kind });
  }

  _logDisabledReason() {
    if (this.disabledReasonLogged) {
      return;
    }

    this.disabledReasonLogged = true;
    logError("Greenhouse WebSocket bridge disabled because gRPC dependencies failed to load", {
      error: grpcDependencyError,
    });
  }

  _send(socket, payload) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  _closeSocket(socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
}

module.exports = new GreenhouseWebSocketService();
