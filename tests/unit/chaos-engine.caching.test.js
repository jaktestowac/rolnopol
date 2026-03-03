import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const chaosEngineService = require("../../services/chaos-engine.service");

describe("ChaosEngineService - Configuration Caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache between tests
    chaosEngineService.configCache = null;
    chaosEngineService.configCacheTimestamp = 0;
  });

  afterEach(() => {
    chaosEngineService._invalidateCache();
  });

  it("should cache config for TTL duration", async () => {
    const dbSpy = vi.spyOn(chaosEngineService.db, "getAll");

    // First call - cache miss
    const result1 = await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1);
    expect(result1).toHaveProperty("mode");
    expect(result1).toHaveProperty("config");

    // Second call within TTL - cache hit
    const result2 = await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1); // Not called again (still 1)

    // Results should be identical
    expect(result1).toEqual(result2);
  });

  it("should invalidate cache after TTL expires", async () => {
    vi.useFakeTimers();
    const dbSpy = vi.spyOn(chaosEngineService.db, "getAll");

    // First call
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1);

    // Advance time past TTL (default 10000ms = 10s)
    vi.advanceTimersByTime(10001); // TTL + 1ms

    // Next call should hit database
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("should invalidate cache on PATCH", async () => {
    const dbSpy = vi.spyOn(chaosEngineService.db, "getAll");

    // Prime cache
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1);

    // PATCH also calls getAll internally and invalidates cache
    await chaosEngineService.patchChaosEngineConfig({ mode: "level2" });
    expect(dbSpy).toHaveBeenCalledTimes(2); // PATCH itself calls getAll

    // Subsequent read hits database (cache was invalidated by PATCH)
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(3); // Cache miss, so getAll called
  });

  it("should invalidate cache on PUT (replace)", async () => {
    const dbSpy = vi.spyOn(chaosEngineService.db, "getAll");

    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1);

    // PUT (replace) doesn't call getAll, only replaceAll, but invalidates cache
    await chaosEngineService.replaceChaosEngineConfig({ mode: "off" });
    expect(dbSpy).toHaveBeenCalledTimes(1); // Still 1, replace doesn't call getAll

    // Subsequent read hits database (cache was invalidated by replace)
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(2); // Cache miss
  });

  it("should invalidate cache on RESET", async () => {
    const dbSpy = vi.spyOn(chaosEngineService.db, "getAll");

    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1);

    // RESET doesn't call getAll, only replaceAll + invalidates cache
    await chaosEngineService.resetChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(1); // Still 1, reset uses replaceAll not getAll

    // Subsequent read hits database (cache was invalidated by RESET)
    await chaosEngineService.getChaosEngineConfig();
    expect(dbSpy).toHaveBeenCalledTimes(2); // Cache miss
  });

  it("should have reasonable cache TTL default", () => {
    expect(chaosEngineService.CACHE_TTL_MS).toBe(10000);
  });

  it("should return same cached instance within TTL", async () => {
    const result1 = await chaosEngineService.getChaosEngineConfig();
    const result2 = await chaosEngineService.getChaosEngineConfig();

    // Should be the exact same object reference (not just equal)
    expect(result1).toBe(result2);
  });
});
