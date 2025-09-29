import { describe, it, expect, vi } from "vitest";
import { validateIdParam } from "../../middleware/id-validation.middleware";

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("validateIdParam middleware", () => {
  it("should call next for valid id", () => {
    const req = { params: { id: "5" } };
    const res = mockRes();
    const next = vi.fn();
    validateIdParam("id")(req, res, next);
    expect(req.params.id).toBe(5);
    expect(next).toHaveBeenCalled();
  });
  it("should return 400 if id is missing", () => {
    const req = { params: {} };
    const res = mockRes();
    const next = vi.fn();
    validateIdParam("id")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it("should return 400 if id is invalid", () => {
    const req = { params: { id: "abc" } };
    const res = mockRes();
    const next = vi.fn();
    validateIdParam("id")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
