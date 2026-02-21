import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const featureFlagsService = require("../../services/feature-flags.service");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");

function mockReq() {
  return { originalUrl: "/api/v1/alerts", method: "GET" };
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("feature-flag middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 when required flag is disabled", async () => {
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: { alertsEnabled: false },
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireFeatureFlag("alertsEnabled", { resourceName: "Alerts" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when flag lookup throws", async () => {
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockRejectedValue(new Error("db down"));

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireFeatureFlag("alertsEnabled", { resourceName: "Alerts" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when required flag is enabled", async () => {
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: { messengerEnabled: true },
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when flags payload is missing the required key", async () => {
    vi.spyOn(featureFlagsService, "getFeatureFlags").mockResolvedValue({
      flags: {},
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireFeatureFlag("alertsEnabled", { resourceName: "Alerts" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
