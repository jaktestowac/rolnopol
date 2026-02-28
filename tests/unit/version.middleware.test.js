import { describe, it, expect, vi } from "vitest";

const versionMiddleware = require("../../middleware/version.middleware");

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
}

describe("version.middleware", () => {
  it("rejects unsupported API versions", () => {
    const req = { originalUrl: "/api/v9/users" };
    const res = createRes();
    const next = vi.fn();

    versionMiddleware.versionRouter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.apiVersion and version headers for supported version", () => {
    const req = { originalUrl: "/api/v1/users" };
    const res = createRes();
    const next = vi.fn();

    versionMiddleware.versionRouter(req, res, next);
    versionMiddleware.versionHeaders(req, res, next);

    expect(req.apiVersion).toBe("v1");
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "X-API-Version": "v1",
        "X-API-Status": expect.any(String),
      }),
    );
  });
});
