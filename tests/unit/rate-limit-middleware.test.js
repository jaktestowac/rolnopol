import { describe, it, expect, vi } from "vitest";
import { createRateLimiter } from "../../middleware/rate-limit.middleware";

describe("rate-limit.middleware", () => {
  it("should return the correct limiter for each type", () => {
    const limiterTypes = ["auth", "verify", "admin", "api"];
    limiterTypes.forEach((type) => {
      const limiter = createRateLimiter(type);
      expect(limiter).toBeDefined();
    });
  });
});
