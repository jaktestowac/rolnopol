const controller = require("../../controllers/resource.controller");
import { describe, it, expect, vi } from "vitest";

describe("resource.controller", () => {
  it("should export a function or an object with at least one function", () => {
    if (typeof controller === "function") {
      expect(typeof controller).toBe("function");
    } else if (typeof controller === "object" && controller !== null) {
      const fn = Object.values(controller).find((v) => typeof v === "function");
      expect(fn).toBeInstanceOf(Function);
    } else {
      throw new Error(
        "Controller does not export a function or an object with functions",
      );
    }
  });
});
