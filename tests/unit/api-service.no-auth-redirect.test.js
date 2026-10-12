import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_SERVICE_PATH = "../../public/js/services/api-service.js";

describe("ApiService noAuthRedirect", () => {
  let service;
  let storage;
  let eventBus;

  beforeEach(() => {
    globalThis.window = { location: { protocol: "http:", href: "/marketplace.html" } };
    globalThis.Utils = { isSwaggerPage: () => false };
    delete require.cache[require.resolve(API_SERVICE_PATH)];
    require(API_SERVICE_PATH);

    storage = { cookie: { get: vi.fn(() => "token-1"), remove: vi.fn() } };
    eventBus = { emit: vi.fn() };
    service = new window.ApiService();
    service.init({ getModule: () => storage, getEventBus: () => eventBus });

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }));
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.Utils;
    delete globalThis.fetch;
  });

  it("logs out and redirects on 401 by default", async () => {
    const result = await service.request("GET", "fields", { requiresAuth: true });

    expect(result).toMatchObject({ success: false, status: 401 });
    expect(storage.cookie.remove).toHaveBeenCalledWith("rolnopolToken");
    expect(eventBus.emit).toHaveBeenCalledWith("auth:logout", { reason: "token_expired" });
    expect(window.location.href).toBe("/login.html");
  });

  it("returns the error without clearing the session or redirecting when noAuthRedirect is set", async () => {
    const result = await service.request("GET", "fields", { requiresAuth: true, noAuthRedirect: true, suppressErrorEvents: true });

    expect(result).toMatchObject({ success: false, status: 401, error: "Unauthorized" });
    expect(storage.cookie.remove).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(window.location.href).toBe("/marketplace.html");
  });
});
