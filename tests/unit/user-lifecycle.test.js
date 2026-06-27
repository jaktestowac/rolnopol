import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Unit tests for the user-lifecycle registry (data layer) introduced to break
// the data → services layering inversion. The data layer emits create/delete
// events; services register handlers (direction stays service → data).

describe("data/user-lifecycle registry", () => {
  let lifecycle;

  beforeEach(() => {
    vi.resetModules();
    lifecycle = require("../../data/user-lifecycle");
    lifecycle._reset();
  });

  it("invokes registered create handlers with the created user", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    lifecycle.onUserCreated("test:create", handler);

    await lifecycle.notifyUserCreated({ id: 42 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 42 });
  });

  it("invokes registered delete handlers with the deleted user", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    lifecycle.onUserDeleted("test:delete", handler);

    await lifecycle.notifyUserDeleted({ id: 7 });

    expect(handler).toHaveBeenCalledWith({ id: 7 });
  });

  it("registration is idempotent per key (re-register replaces, no duplicates)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    lifecycle.onUserCreated("dup", first);
    lifecycle.onUserCreated("dup", second);

    await lifecycle.notifyUserCreated({ id: 1 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is best-effort on create: a throwing handler is swallowed and never blocks user creation", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("financial init failed"));
    const next = vi.fn();
    lifecycle.onUserCreated("a", boom);
    lifecycle.onUserCreated("b", next);

    await expect(lifecycle.notifyUserCreated({ id: 1 })).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1); // later handlers still run
  });

  it("propagates errors on delete (a failed cascade must fail the delete)", async () => {
    lifecycle.onUserDeleted("boom", vi.fn().mockRejectedValue(new Error("cascade failed")));

    await expect(lifecycle.notifyUserDeleted({ id: 1 })).rejects.toThrow("cascade failed");
  });

  it("ignores non-function handlers", async () => {
    expect(() => lifecycle.onUserCreated("bad", null)).not.toThrow();
    await expect(lifecycle.notifyUserCreated({ id: 1 })).resolves.toBeUndefined();
  });
});

describe("data layer no longer depends on the service layer (regression guard for #2)", () => {
  const read = (rel) => readFileSync(resolve(__dirname, "../../", rel), "utf-8");

  it("data/user-database.js does not require any services/* module", () => {
    const src = read("data/user-database.js");
    expect(src).not.toMatch(/require\(["'][^"']*services\//);
  });

  it("data/user-lifecycle.js does not require any services/* module", () => {
    const src = read("data/user-lifecycle.js");
    expect(src).not.toMatch(/require\(["'][^"']*services\//);
  });
});
