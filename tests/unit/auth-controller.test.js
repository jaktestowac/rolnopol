const authController = require("../../controllers/auth.controller");
import { describe, it, expect } from "vitest";

describe("auth.controller", () => {
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
});
