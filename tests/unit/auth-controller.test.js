const authController = require("../../controllers/auth.controller");
const authService = require("../../services/auth.service");
import { describe, it, expect } from "vitest";
import { vi, beforeEach } from "vitest";

function createMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
}

describe("auth.controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should export an object", () => {
    expect(typeof authController).toBe("object");
  });

  it("should have a register method", () => {
    expect(typeof authController.register).toBe("function");
  });

  it("should have a login method", () => {
    expect(typeof authController.login).toBe("function");
  });

  it("should have a logout method", () => {
    expect(typeof authController.logout).toBe("function");
  });

  it("register should set auth cookies and return 201 for a valid registration", async () => {
    const req = {
      body: {
        email: "new.user@test.com",
        displayedName: "New User",
        password: "StrongPass1!",
      },
    };
    const res = createMockRes();

    vi.spyOn(authService, "registerUser").mockResolvedValue({
      user: { id: 123, email: "new.user@test.com", displayedName: "New User" },
      token: "valid-token",
      expiration: { hours: 24 },
      loginTime: "2026-02-21T10:00:00.000Z",
      cookieMaxAge: 86400000,
    });

    await authController.register(req, res);

    expect(res.cookie).toHaveBeenCalledWith("rolnopolToken", "valid-token", expect.objectContaining({ sameSite: "lax", httpOnly: false }));
    expect(res.cookie).toHaveBeenCalledWith(
      "rolnopolLoginTime",
      "2026-02-21T10:00:00.000Z",
      expect.objectContaining({ sameSite: "lax", httpOnly: false }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("login should map invalid credentials to 401", async () => {
    const req = {
      body: {
        email: "user@test.com",
        password: "wrong-pass",
      },
    };
    const res = createMockRes();

    vi.spyOn(authService, "loginUser").mockRejectedValue(new Error("Invalid credentials"));

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
  });

  it("logout should clear auth cookies", async () => {
    const req = {};
    const res = createMockRes();

    await authController.logout(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith("rolnopolToken");
    expect(res.clearCookie).toHaveBeenCalledWith("rolnopolLoginTime");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
