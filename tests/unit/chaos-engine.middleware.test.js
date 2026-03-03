import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// we will stub the service to control config returned
const chaosEngineService = require("../../services/chaos-engine.service");
const chaosMiddleware = require("../../middleware/chaos-engine.middleware");

function mockRes() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    write: vi.fn(),
  };
}

function makeReq(overrides = {}) {
  return {
    path: "/v1/about",
    method: "GET",
    headers: {},
    query: {},
    ip: "127.0.0.1",
    socket: { destroy: vi.fn() },
    ...overrides,
  };
}

describe("chaos-engine.middleware when engine is off", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(chaosEngineService, "getChaosEngineConfig").mockResolvedValue({
      mode: "off",
      config: { enabled: false },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call next without touching response headers or delaying", async () => {
    const req = makeReq();
    const res = mockRes();
    let nextCalled = false;

    await chaosMiddleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should also bypass middleware for control-plane paths even when off", async () => {
    const req = makeReq({ path: "/v1/chaos-engine/reset" });
    const res = mockRes();
    let nextCalled = false;

    await chaosMiddleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    // middleware still fetches config (used to build response) but should not
    // manipulate headers or status even when path is part of control plane.
    expect(chaosEngineService.getChaosEngineConfig).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
