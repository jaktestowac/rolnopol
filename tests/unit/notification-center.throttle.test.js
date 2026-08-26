import { describe, it, expect } from "vitest";

// Dedupe and rate limiting (modules/notification-center/core/notification-throttle.js).
//
// Every policy in the module has declared `dedupe` and `rateLimit` since it was
// written, and until now nothing read either. These tests pin the semantics that
// were chosen when they were made live — in particular the split that makes both
// fields worth having: dedupe asks "have I already told them THIS?", rateLimit
// asks "have I told them too much?".
//
// The clock is injected, so window boundaries are stood on rather than waited out.
const { NotificationThrottle, recipientOf } = require("../../modules/notification-center/core/notification-throttle");

const event = (overrides = {}) => ({
  type: "crew.tool.issued",
  correlationId: "crew-tool-issuance-1",
  timestamp: "2026-08-27T09:00:00.000Z",
  payload: { userId: 1 },
  ...overrides,
});

const policy = (overrides = {}) => ({
  id: "policy.test",
  dedupe: { seconds: 0 },
  rateLimit: { max: 0, windowSeconds: 0 },
  ...overrides,
});

/** A throttle whose clock the test moves by hand. */
function atClock(startMs = 1_000_000) {
  let current = startMs;
  const throttle = new NotificationThrottle({ now: () => current });
  return { throttle, advance: (seconds) => (current += seconds * 1000) };
}

describe("notification throttle — dedupe", () => {
  it("lets the first event through and refuses an identical repeat", () => {
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    expect(throttle.check(event(), p).allowed).toBe(true);
    const second = throttle.check(event(), p);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("duplicate");
  });

  it("lets the repeat through once the window has passed", () => {
    const { throttle, advance } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    throttle.check(event(), p);
    advance(59);
    expect(throttle.check(event(), p).allowed).toBe(false);
    advance(2); // now 61s from the first
    expect(throttle.check(event(), p).allowed).toBe(true);
  });

  it("keys on the correlationId, so two DIFFERENT subjects both get through", () => {
    // This is the whole reason dedupe is not just a rate limit of one: two
    // genuinely different tool trips must both be announced, however close
    // together they land.
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    expect(throttle.check(event({ correlationId: "trip-1" }), p).allowed).toBe(true);
    expect(throttle.check(event({ correlationId: "trip-2" }), p).allowed).toBe(true);
    expect(throttle.check(event({ correlationId: "trip-1" }), p).allowed).toBe(false);
  });

  it("keys on the recipient, so one user's repeat does not silence another's first", () => {
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    expect(throttle.check(event({ payload: { userId: 1 } }), p).allowed).toBe(true);
    expect(throttle.check(event({ payload: { userId: 2 } }), p).allowed).toBe(true);
  });

  it("keys on the event type, so the two halves of a shared correlationId both pass", () => {
    // tools/notifications.js gives issue and return ONE correlationId on purpose.
    // They must not collide.
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    expect(throttle.check(event({ type: "crew.tool.issued" }), p).allowed).toBe(true);
    expect(throttle.check(event({ type: "crew.tool.returned" }), p).allowed).toBe(true);
  });

  it("is disabled by a zero, a negative, or a missing window", () => {
    // Most policies in the module carry `dedupe: { seconds: 0 }`, which has always
    // meant "no dedupe". Making the field live must not change that.
    for (const dedupe of [{ seconds: 0 }, { seconds: -5 }, {}, undefined]) {
      const { throttle } = atClock();
      const p = policy({ dedupe });
      expect(throttle.check(event(), p).allowed, JSON.stringify(dedupe)).toBe(true);
      expect(throttle.check(event(), p).allowed, JSON.stringify(dedupe)).toBe(true);
    }
  });
});

describe("notification throttle — rate limit", () => {
  it("allows exactly max events inside the window and refuses the next", () => {
    const { throttle } = atClock();
    const p = policy({ rateLimit: { max: 3, windowSeconds: 300 } });

    for (let i = 0; i < 3; i += 1) {
      expect(throttle.check(event({ correlationId: `c-${i}` }), p).allowed, `event ${i}`).toBe(true);
    }
    const refused = throttle.check(event({ correlationId: "c-4" }), p);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe("rate_limited");
  });

  it("counts distinct subjects, unlike dedupe", () => {
    const { throttle } = atClock();
    const p = policy({ rateLimit: { max: 2, windowSeconds: 300 } });

    expect(throttle.check(event({ correlationId: "a" }), p).allowed).toBe(true);
    expect(throttle.check(event({ correlationId: "b" }), p).allowed).toBe(true);
    expect(throttle.check(event({ correlationId: "c" }), p).allowed).toBe(false);
  });

  it("slides — room frees up as old hits age out", () => {
    const { throttle, advance } = atClock();
    const p = policy({ rateLimit: { max: 2, windowSeconds: 100 } });

    throttle.check(event({ correlationId: "a" }), p);
    advance(50);
    throttle.check(event({ correlationId: "b" }), p);
    expect(throttle.check(event({ correlationId: "c" }), p).allowed).toBe(false);

    advance(51); // "a" is now 101s old and out of the window
    expect(throttle.check(event({ correlationId: "c" }), p).allowed).toBe(true);
  });

  it("is per recipient, so a busy account cannot throttle a quiet one", () => {
    const { throttle } = atClock();
    const p = policy({ rateLimit: { max: 1, windowSeconds: 300 } });

    expect(throttle.check(event({ payload: { userId: 1 }, correlationId: "a" }), p).allowed).toBe(true);
    expect(throttle.check(event({ payload: { userId: 1 }, correlationId: "b" }), p).allowed).toBe(false);
    expect(throttle.check(event({ payload: { userId: 2 }, correlationId: "c" }), p).allowed).toBe(true);
  });

  it("is disabled by a zero max or a zero window", () => {
    for (const rateLimit of [{ max: 0, windowSeconds: 300 }, { max: 5, windowSeconds: 0 }, {}, undefined]) {
      const { throttle } = atClock();
      const p = policy({ rateLimit });
      for (let i = 0; i < 20; i += 1) {
        expect(throttle.check(event({ correlationId: `c-${i}` }), p).allowed, JSON.stringify(rateLimit)).toBe(true);
      }
    }
  });

  it("does not spend budget on an event dedupe already refused", () => {
    // Order matters: dedupe runs first and returns, so a replayed event cannot
    // eat the recipient's rate-limit allowance.
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 }, rateLimit: { max: 2, windowSeconds: 300 } });

    expect(throttle.check(event({ correlationId: "a" }), p).allowed).toBe(true);
    expect(throttle.check(event({ correlationId: "a" }), p).allowed).toBe(false); // duplicate
    expect(throttle.check(event({ correlationId: "a" }), p).allowed).toBe(false); // duplicate
    // Only one hit was ever recorded, so a second distinct subject still fits.
    expect(throttle.check(event({ correlationId: "b" }), p).allowed).toBe(true);
  });

  it("does not extend a dedupe window from a rate-limited event", () => {
    // A rate-limited event was never accepted, so it must not stamp the dedupe
    // map — otherwise a burst would keep pushing its own window forward.
    const { throttle, advance } = atClock();
    const p = policy({ dedupe: { seconds: 100 }, rateLimit: { max: 1, windowSeconds: 100 } });

    expect(throttle.check(event({ correlationId: "a" }), p).allowed).toBe(true);
    advance(50);
    expect(throttle.check(event({ correlationId: "b" }), p).allowed).toBe(false); // rate limited
    advance(51); // both windows have now passed for "b", which was never stamped
    expect(throttle.check(event({ correlationId: "b" }), p).allowed).toBe(true);
  });
});

describe("notification throttle — recipient resolution", () => {
  it("matches the dispatcher's own fallback chain", () => {
    // If these two ever disagree, an event would be suppressed for one person and
    // addressed to another.
    expect(recipientOf({ payload: { userId: 7 } })).toBe("7");
    expect(recipientOf({ payload: { toUserId: 8 } })).toBe("8");
    expect(recipientOf({ payload: { buyerId: 9 } })).toBe("9");
    expect(recipientOf({ payload: { staffId: 10 } })).toBe("10");
    expect(recipientOf({ payload: { userId: 1, staffId: 10 } })).toBe("1");
  });

  it("gives an unaddressed event a stable bucket rather than a missing one", () => {
    expect(recipientOf({ payload: {} })).toBe("anonymous");
    expect(recipientOf({})).toBe("anonymous");
    expect(recipientOf(null)).toBe("anonymous");
  });
});

describe("notification throttle — housekeeping", () => {
  it("forgets every window on reset", () => {
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });

    throttle.check(event(), p);
    expect(throttle.check(event(), p).allowed).toBe(false);
    throttle.reset();
    expect(throttle.check(event(), p).allowed).toBe(true);
  });

  it("explains itself — a refusal carries a readable detail", () => {
    const { throttle } = atClock();
    const p = policy({ dedupe: { seconds: 60 } });
    throttle.check(event(), p);

    const refused = throttle.check(event(), p);
    expect(refused.detail).toContain("crew.tool.issued");
    expect(refused.detail).toContain("60s");
  });
});
