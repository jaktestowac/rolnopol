import { describe, it, expect } from "vitest";

const PolicyRouter = require("../../modules/notification-center/core/policy-router");
const policies = require("../../modules/notification-center/core/policies");

describe("notification-center policy router", () => {
  it("resolves policy for known MVP event", () => {
    const router = new PolicyRouter(policies);
    const policy = router.resolve({
      type: "transaction.created",
      timestamp: new Date().toISOString(),
      correlationId: "corr-1",
      payload: { userId: 1 },
    });

    expect(policy).toBeTruthy();
    expect(policy.id).toBe("policy.transaction.default");
    expect(policy.channels).toEqual(["in-app", "webhook"]);
  });

  it("returns null when policy is missing", () => {
    const router = new PolicyRouter(policies);
    const policy = router.resolve({
      type: "unregistered.event",
      timestamp: new Date().toISOString(),
      correlationId: "corr-2",
      payload: { userId: 1 },
    });

    expect(policy).toBeNull();
  });
});
