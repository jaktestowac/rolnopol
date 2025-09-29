const userController = require("../../controllers/user.controller");
import { describe, it, expect } from "vitest";

describe("user.controller", () => {
  it("should export an object", () => {
    expect(typeof userController).toBe("object");
  });

  [
    "getProfile",
    "updateProfile",
    "updateUserById",
    "deleteProfile",
    "getUserStatistics",
    "getAllUsersStatistics",
  ].forEach((method) => {
    it(`should have a ${method} method`, () => {
      expect(typeof userController[method]).toBe("function");
    });
  });
});
