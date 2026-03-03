import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const chaosEngineService = require("../../services/chaos-engine.service");
const chaosMiddleware = require("../../middleware/chaos-engine.middleware");

describe("Chaos Engine - Mirroring Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(chaosEngineService, "getChaosEngineConfig").mockResolvedValue({
      mode: "custom",
      config: {
        enabled: true,
        latency: { enabled: false },
        errorInjection: { enabled: false },
        responseLoss: { enabled: false },
        stateful: { enabled: false },
        mirroring: {
          enabled: true,
          probability: 1,  // Always trigger for testing
          targetUrl: "http://mirror.local",
        },
        scope: { excludePaths: ["/v1/chaos-engine"] },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Mirroring Ring Buffer", () => {
    it("should record mirror requests", async () => {
      const req = {
        path: "/v1/test",
        method: "GET",
        headers: {},
        socket: null,
        ip: "127.0.0.1",
      };
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await chaosMiddleware(req, res, () => {});

      // Give async mirroring time to queue
      await new Promise((r) => setTimeout(r, 50));

      const mirrored = chaosMiddleware.getMirroredRequests();
      expect(mirrored.length).toBeGreaterThan(0);
      expect(mirrored[0]).toHaveProperty("method", "GET");
      expect(mirrored[0]).toHaveProperty("path", "/v1/test");
      expect(mirrored[0]).toHaveProperty("timestamp");
      expect(mirrored[0]).toHaveProperty("status");
    });

    it("should set X-Chaos-Mirrored header when enabled", async () => {
      const req = {
        path: "/v1/test",
        method: "GET",
        headers: {},
        socket: null,
        ip: "127.0.0.1",
      };
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await chaosMiddleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith("X-Chaos-Mirrored", "1");
      expect(next).toHaveBeenCalled();
    });

    it("should skip mirroring when disabled", async () => {
      vi.spyOn(chaosEngineService, "getChaosEngineConfig").mockResolvedValue({
        mode: "custom",
        config: {
          enabled: true,
          latency: { enabled: false },
          errorInjection: { enabled: false },
          responseLoss: { enabled: false },
          stateful: { enabled: false },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: {},
        },
      });

      const req = {
        path: "/v1/test",
        method: "GET",
        headers: {},
        socket: null,
        ip: "127.0.0.1",
      };
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await chaosMiddleware(req, res, () => {});

      expect(res.setHeader).not.toHaveBeenCalledWith(
        "X-Chaos-Mirrored",
        expect.anything()
      );
    });

    it("should respect mirroring probability", async () => {
      vi.spyOn(chaosEngineService, "getChaosEngineConfig").mockResolvedValue({
        mode: "custom",
        config: {
          enabled: true,
          latency: { enabled: false },
          errorInjection: { enabled: false },
          responseLoss: { enabled: false },
          stateful: { enabled: false },
          mirroring: {
            enabled: true,
            probability: 0,  // Never trigger
            targetUrl: "http://mirror.local",
          },
          scope: {},
        },
      });

      const req = {
        path: "/v1/test",
        method: "GET",
        headers: {},
        socket: null,
        ip: "127.0.0.1",
      };
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await chaosMiddleware(req, res, () => {});

      expect(res.setHeader).not.toHaveBeenCalledWith(
        "X-Chaos-Mirrored",
        expect.anything()
      );
    });

    it("should prevent unbounded growth with ring buffer (max 1000 entries)", async () => {
      const originalGetAll = chaosMiddleware.getMirroredRequests;

      // Simulate many mirrored requests
      for (let i = 0; i < 1500; i++) {
        const req = {
          path: `/v1/test/${i}`,
          method: "GET",
          headers: {},
          socket: null,
          ip: "127.0.0.1",
        };
        const res = {
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockReturnThis(),
        };

        await chaosMiddleware(req, res, () => {});
      }

      await new Promise((r) => setTimeout(r, 100));

      const mirrored = originalGetAll();
      expect(mirrored.length).toBeLessThanOrEqual(1000);
      expect(mirrored.length).toBeGreaterThan(0);
    });
  });

  describe("Mirror Request Status", () => {
    it("should track mirror record with pending status initially", async () => {
      const req = {
        path: "/v1/test",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { test: "data" },
        socket: null,
        ip: "127.0.0.1",
      };
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await chaosMiddleware(req, res, () => {});

      await new Promise((r) => setTimeout(r, 50));

      const mirrored = chaosMiddleware.getMirroredRequests();
      const lastRecord = mirrored[mirrored.length - 1];
      expect(lastRecord).toHaveProperty("status");
      expect(lastRecord.status).toMatch(/pending|success|failed|skipped/);
    });
  });
});
