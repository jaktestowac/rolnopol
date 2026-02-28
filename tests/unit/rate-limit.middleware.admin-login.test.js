import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { adminLoginLimiter, MAX_LOGIN_ATTEMPTS } from "../../middleware/rate-limit.middleware";

function createReq(ip = "127.0.0.1") {
  return { ip };
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe("rate-limit admin login limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("blocks client after max failed attempts", () => {
    const ip = "10.10.10.10";

    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      const req = createReq(ip);
      const res = createRes();
      const next = vi.fn();
      adminLoginLimiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      req.adminLoginAttempts.recordFailed();
    }

    const blockedReq = createReq(ip);
    const blockedRes = createRes();
    const blockedNext = vi.fn();

    adminLoginLimiter(blockedReq, blockedRes, blockedNext);

    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedNext).not.toHaveBeenCalled();
  });

  it("unblocks client after block duration expires", () => {
    const ip = "10.10.10.11";

    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      const req = createReq(ip);
      adminLoginLimiter(req, createRes(), vi.fn());
      req.adminLoginAttempts.recordFailed();
    }

    vi.advanceTimersByTime(16 * 60 * 1000);

    const reqAfter = createReq(ip);
    const resAfter = createRes();
    const nextAfter = vi.fn();

    adminLoginLimiter(reqAfter, resAfter, nextAfter);

    expect(nextAfter).toHaveBeenCalledTimes(1);
    expect(resAfter.status).not.toHaveBeenCalled();
  });
});
