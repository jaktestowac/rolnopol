import { describe, it, expect, vi } from "vitest";
import { authenticateUser } from "../../middleware/auth.middleware";

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("authenticateUser middleware", () => {
  it("should return 401 if no token is provided", () => {
    const req = { headers: {}, cookies: {} };
    const res = mockRes();
    const next = vi.fn();
    authenticateUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 if token is invalid", () => {
    const req = { headers: { token: "invalid" }, cookies: {} };
    const res = mockRes();
    const next = vi.fn();
    vi.mock("../../helpers/token.helpers", () => ({
      isUserLogged: () => false,
    }));
    authenticateUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // For a valid token, you would need to mock isUserLogged and getUserId to return true and a userId
});
