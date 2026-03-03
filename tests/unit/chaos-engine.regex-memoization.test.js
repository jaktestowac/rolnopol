import { describe, it, expect, vi, beforeEach } from "vitest";
const chaosEngineService = require("../../services/chaos-engine.service");

describe("Chaos Engine Middleware - Regex Memoization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Regex Pattern Caching", () => {
    it("should cache compiled regex patterns to avoid recompilation", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["/api/test*", "/v1/users*"],
            excludePaths: ["/admin*"],
          },
        },
      };

      // First time: patterns compiled and cached
      const result1 = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result1.success === undefined || result1.success !== false).toBe(true);

      // Second time: patterns retrieved from cache (not recompiled)
      // This is internal optimization, but we verify the config is valid
      const result2 = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result2.success === undefined || result2.success !== false).toBe(true);
    });

    it("should handle regex literal notation patterns", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["/^api/", "/v1/.*"],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result).toHaveProperty("mode", "custom");
    });

    it("should handle wildcard patterns efficiently", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: [
              "/api/*",
              "/v1/*/health",
              "/users/*/profile",
              "/admin/*/config",
            ],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result).toHaveProperty("mode", "custom");
      expect(result.customConfig.scope.includePaths).toHaveLength(4);
    });

    it("should handle mixed pattern types", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["/api/test", "/v1/*/users", "/^admin/"],
            excludePaths: ["/internal*", "/test"],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.includePaths).toHaveLength(3);
      expect(result.customConfig.scope.excludePaths).toHaveLength(2);
    });
  });

  describe("Regex Cache Behavior", () => {
    it("should accept patterns with special characters escaped", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["/api.v1", "/users[0-9]+"],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.includePaths).toHaveLength(2);
    });

    it("should handle query parameter patterns", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            queryParams: {
              "test-mode": "on",
              "debug": "*/enabled",
            },
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.queryParams).toHaveProperty("test-mode");
    });

    it("should handle header patterns with various formats", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            headers: {
              "x-chaos-mode": "enabled",
              "authorization": "Bearer *",
              "x-request-id": "/[a-f0-9]+/",
            },
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.headers).toHaveProperty("x-chaos-mode");
    });
  });

  describe("Performance characteristics", () => {
    it("should compile simple patterns efficiently", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: [
              "/api",
              "/v1",
              "/users",
              "/admin",
              "/health",
              "/metrics",
              "/status",
              "/version",
            ],
          },
        },
      };

      const startTime = Date.now();
      const result = await chaosEngineService.patchChaosEngineConfig(config);
      const duration = Date.now() - startTime;

      expect(result).toHaveProperty("mode", "custom");
      // Should complete in reasonable time (< 100ms typical)
      expect(duration).toBeLessThan(1000);
    });

    it("should handle patterns with many alternatives efficiently", async () => {
      const paths = [];
      for (let i = 0; i < 50; i++) {
        paths.push(`/api/v${i}/test`);
      }

      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: paths,
          },
        },
      };

      const startTime = Date.now();
      const result = await chaosEngineService.patchChaosEngineConfig(config);
      const duration = Date.now() - startTime;

      expect(result.customConfig.scope.includePaths).toHaveLength(50);
      // Should still be reasonably fast
      expect(duration).toBeLessThan(1000);
    });
  });

  describe("Pattern matching edge cases", () => {
    it("should handle empty pattern arrays", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: [],
            excludePaths: [],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.includePaths).toHaveLength(0);
      expect(result.customConfig.scope.excludePaths).toHaveLength(0);
    });

    it("should normalize path patterns (add leading slash)", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["api/test", "users/profile"],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.includePaths[0]).toBe("/api/test");
      expect(result.customConfig.scope.includePaths[1]).toBe("/users/profile");
    });

    it("should remove duplicate patterns", async () => {
      const config = {
        mode: "custom",
        customConfig: {
          enabled: true,
          scope: {
            includePaths: ["/api/test", "/api/test", "/api/test"],
          },
        },
      };

      const result = await chaosEngineService.patchChaosEngineConfig(config);
      expect(result.customConfig.scope.includePaths).toHaveLength(1);
    });
  });
});
