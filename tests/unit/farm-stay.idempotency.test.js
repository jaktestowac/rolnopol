import { describe, it, expect, beforeEach } from "vitest";
const path = require("path");

const { withIdempotency, _clear } = require(path.join(__dirname, "..", "..", "modules", "farm-stay", "idempotency.js"));

beforeEach(() => _clear());

describe("farm-stay idempotency guard", () => {
  it("passes through (runs every time) when no key is supplied", async () => {
    let calls = 0;
    const run = () => withIdempotency({ namespace: "confirm", user: "u1" }, async () => ({ status: 200, body: { n: ++calls } }));
    const a = await run();
    const b = await run();
    expect(a).toEqual({ status: 200, body: { n: 1 }, replayed: false });
    expect(b).toEqual({ status: 200, body: { n: 2 }, replayed: false });
    expect(calls).toBe(2);
  });

  it("runs once per (namespace,user,key) and replays the stored result", async () => {
    let calls = 0;
    const fn = async () => ({ status: 200, body: { charged: 100, call: ++calls } });
    const first = await withIdempotency({ namespace: "confirm", user: "u1", key: "k1" }, fn);
    const second = await withIdempotency({ namespace: "confirm", user: "u1", key: "k1" }, fn);
    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body); // same stored outcome, no re-charge
  });

  it("collapses concurrent duplicates onto a single execution", async () => {
    let calls = 0;
    const fn = () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: { call: ++calls } }), 20));
    const [a, b] = await Promise.all([
      withIdempotency({ namespace: "confirm", user: "u1", key: "race" }, fn),
      withIdempotency({ namespace: "confirm", user: "u1", key: "race" }, fn),
    ]);
    expect(calls).toBe(1);
    expect(a.body).toEqual(b.body);
    // exactly one of the two is the fresh run; the other is a replay
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("namespaces by user and operation so keys never collide across callers", async () => {
    const mk = (user, ns) => withIdempotency({ namespace: ns, user, key: "same" }, async () => ({ status: 200, body: { user, ns } }));
    const u1 = await mk("u1", "confirm");
    const u2 = await mk("u2", "confirm"); // different user, same key → own execution
    const c1 = await mk("u1", "cancel"); // different namespace, same key/user → own execution
    expect(u1.replayed).toBe(false);
    expect(u2.replayed).toBe(false);
    expect(c1.replayed).toBe(false);
  });

  it("does not cache a thrown handler (a later retry may still run)", async () => {
    let attempt = 0;
    const flaky = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return { status: 200, body: { ok: true } };
    };
    await expect(withIdempotency({ namespace: "confirm", user: "u1", key: "kx" }, flaky)).rejects.toThrow("transient");
    const retry = await withIdempotency({ namespace: "confirm", user: "u1", key: "kx" }, flaky);
    expect(retry.replayed).toBe(false);
    expect(retry.body).toEqual({ ok: true });
    expect(attempt).toBe(2);
  });
});
