import { afterEach, describe, expect, it, vi } from "vitest";

function createRequest({
  url = "/api/v1/notifications/ws",
  authorization,
  cookie,
  host = "localhost:3000",
  origin = "http://localhost:3000",
} = {}) {
  return {
    url,
    headers: {
      host,
      origin,
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  };
}

async function loadNotificationWebSocketService({ featureFlags = { flags: { notificationCenterEnabled: true } }, tokenHelpers = {} } = {}) {
  vi.resetModules();

  const notificationWsModule = await import("../../services/notification-ws.service.js");
  const resolvedModule = notificationWsModule.default || notificationWsModule;
  const featureFlagsService = require("../../services/feature-flags.service");
  const tokenHelpersModule = require("../../helpers/token.helpers");

  vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue(featureFlags);
  vi.spyOn(tokenHelpersModule, "isAdminToken").mockImplementation(tokenHelpers.isAdminToken || (() => false));
  vi.spyOn(tokenHelpersModule, "isUserLogged").mockImplementation(tokenHelpers.isUserLogged || (() => false));
  vi.spyOn(tokenHelpersModule, "getUserId").mockImplementation(tokenHelpers.getUserId || (() => undefined));

  return {
    NotificationWebSocketService: resolvedModule.NotificationWebSocketService,
    featureFlagsService,
    tokenHelpersModule,
  };
}

describe("notification websocket service", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("rejects websocket upgrades when notificationCenterEnabled is disabled", async () => {
    const { NotificationWebSocketService } = await loadNotificationWebSocketService({
      featureFlags: { flags: { notificationCenterEnabled: false } },
    });
    const service = new NotificationWebSocketService();

    await expect(
      service._authenticateUpgrade(
        createRequest({
          authorization: "Bearer any-token",
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Notification center not found",
    });
  });

  it("accepts admin websocket upgrades using krakenToken cookie", async () => {
    const { NotificationWebSocketService, tokenHelpersModule } = await loadNotificationWebSocketService({
      tokenHelpers: {
        isAdminToken: vi.fn((token) => token === "admin-token"),
      },
    });
    const service = new NotificationWebSocketService();

    const context = await service._authenticateUpgrade(
      createRequest({
        cookie: "krakenToken=admin-token",
      }),
    );

    expect(tokenHelpersModule.isAdminToken).toHaveBeenCalledWith("admin-token");
    expect(context).toEqual(
      expect.objectContaining({
        role: "admin",
        userId: "kraken-admin",
        token: "admin-token",
      }),
    );
  });

  it("broadcasts realtime packets to admins and only matching notification users", async () => {
    const { NotificationWebSocketService } = await loadNotificationWebSocketService();
    const service = new NotificationWebSocketService();

    const adminSocket = {
      readyState: 1,
      send: vi.fn(),
    };
    const targetUserSocket = {
      readyState: 1,
      send: vi.fn(),
    };
    const otherUserSocket = {
      readyState: 1,
      send: vi.fn(),
    };

    service.adminSockets.add(adminSocket);
    service.userSockets.set(42, new Set([targetUserSocket]));
    service.userSockets.set(7, new Set([otherUserSocket]));

    service._handleRealtimePacket({
      entity: "event",
      action: "updated",
      record: { id: "evt-1", status: "processed" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    expect(adminSocket.send).toHaveBeenCalledTimes(1);
    expect(targetUserSocket.send).not.toHaveBeenCalled();
    expect(otherUserSocket.send).not.toHaveBeenCalled();

    service._handleRealtimePacket({
      entity: "notification",
      action: "created",
      record: { id: "notif-1", userId: 42, status: "pending" },
      occurredAt: "2026-01-01T00:00:01.000Z",
    });

    expect(adminSocket.send).toHaveBeenCalledTimes(2);
    expect(targetUserSocket.send).toHaveBeenCalledTimes(1);
    expect(otherUserSocket.send).not.toHaveBeenCalled();

    const userPayload = JSON.parse(targetUserSocket.send.mock.calls[0][0]);
    expect(userPayload).toEqual({
      type: "notification_center_update",
      data: expect.objectContaining({
        entity: "notification",
        action: "created",
        record: expect.objectContaining({
          id: "notif-1",
          userId: 42,
        }),
      }),
    });
  });
});
