import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Every teardown target is replaced through require.cache, because the service
// requires them lazily inside shutdownApplication() — the same technique
// tests/unit/auth-middleware.test.js uses for its lazily required service.
const DEPENDENCY_PATHS = {
  serviceLauncher: "../../services/service-launcher.service",
  pluginRuntime: "../../modules/plugin-runtime",
  notificationCenter: "../../modules/notification-center",
  notificationWs: "../../services/notification-ws.service",
  messengerWs: "../../services/messenger-ws.service",
  greenhouseWs: "../../services/greenhouse-ws.service",
  databaseInit: "../../data/database-init",
};

const savedCacheEntries = new Map();

function stubModule(relativePath, exports) {
  const resolved = require.resolve(relativePath);

  if (!savedCacheEntries.has(resolved)) {
    savedCacheEntries.set(resolved, require.cache[resolved]);
  }

  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function restoreStubbedModules() {
  for (const [resolved, original] of savedCacheEntries) {
    if (original === undefined) {
      delete require.cache[resolved];
    } else {
      require.cache[resolved] = original;
    }
  }
  savedCacheEntries.clear();
}

/**
 * Stub every dependency, recording the order in which the steps run.
 * `failing` names the dependencies whose step should reject.
 */
function stubDependencies(failing = []) {
  const calls = [];
  const record = (name) => () => {
    calls.push(name);
    if (failing.includes(name)) return Promise.reject(new Error(`${name} exploded`));
    return Promise.resolve();
  };

  stubModule(DEPENDENCY_PATHS.serviceLauncher, { shutdownAll: vi.fn(record("serviceLauncher")) });
  stubModule(DEPENDENCY_PATHS.pluginRuntime, { shutdown: vi.fn(record("pluginRuntime")) });
  stubModule(DEPENDENCY_PATHS.notificationCenter, { stop: vi.fn(record("notificationCenter")) });
  stubModule(DEPENDENCY_PATHS.notificationWs, { close: vi.fn(record("notificationWs")) });
  stubModule(DEPENDENCY_PATHS.messengerWs, { close: vi.fn(record("messengerWs")) });
  stubModule(DEPENDENCY_PATHS.greenhouseWs, { close: vi.fn(record("greenhouseWs")) });
  stubModule(DEPENDENCY_PATHS.databaseInit, { cleanupDatabases: vi.fn(record("databaseInit")) });

  return calls;
}

function loadService() {
  const resolved = require.resolve("../../services/app-shutdown.service");
  delete require.cache[resolved];
  return require(resolved);
}

describe("app-shutdown.service", () => {
  let service;

  beforeEach(() => {
    service = null;
  });

  afterEach(() => {
    if (service) service.resetForTests();
    restoreStubbedModules();
    vi.restoreAllMocks();
  });

  it("tears every subsystem down, then exits with the given code", async () => {
    const calls = stubDependencies();
    service = loadService();
    const exit = vi.fn();

    const performed = await service.shutdownApplication({ reason: "test", exitCode: 3, exit });

    expect(performed).toBe(true);
    expect(calls).toEqual([
      // Launched external services go first so they are not orphaned, and the
      // databases go last so nothing can write after the flush.
      "serviceLauncher",
      "pluginRuntime",
      "notificationWs",
      "messengerWs",
      "greenhouseWs",
      "notificationCenter",
      "databaseInit",
    ]);
    expect(exit).toHaveBeenCalledWith(3);
  });

  it("defaults to exit code 0", async () => {
    stubDependencies();
    service = loadService();
    const exit = vi.fn();

    await service.shutdownApplication({ exit });

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still reaches exit when a step throws", async () => {
    const calls = stubDependencies(["pluginRuntime", "notificationCenter"]);
    service = loadService();
    const exit = vi.fn();

    await service.shutdownApplication({ reason: "test", exit });

    // Failures are logged and skipped — the steps after them still ran.
    expect(calls).toContain("databaseInit");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is idempotent — a second call does nothing", async () => {
    const calls = stubDependencies();
    service = loadService();
    const exit = vi.fn();

    expect(await service.shutdownApplication({ reason: "first", exit })).toBe(true);
    expect(await service.shutdownApplication({ reason: "second", exit })).toBe(false);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(calls.filter((name) => name === "databaseInit")).toHaveLength(1);
  });

  it("reports whether a shutdown has started", async () => {
    stubDependencies();
    service = loadService();

    expect(service.isShuttingDown()).toBe(false);
    await service.shutdownApplication({ reason: "test", exit: vi.fn() });
    expect(service.isShuttingDown()).toBe(true);
  });
});
