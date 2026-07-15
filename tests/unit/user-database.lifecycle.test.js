import { describe, it, expect, vi, beforeEach } from "vitest";

// The linchpin of refactor #2: UserDatabase (data layer) must actually EMIT the
// lifecycle events. If these calls were dropped, the financial-account init and
// resource cascade-delete would silently stop — and no other test would catch
// it (getAccount auto-creates on read; the delete cascade has no e2e coverage).
//
// The underlying JSON database is stubbed so this stays a fast, side-effect-free
// unit test that isolates the emit behavior.

describe("UserDatabase emits user-lifecycle events (#2 linchpin)", () => {
  let lifecycle;
  let db;

  beforeEach(() => {
    vi.resetModules();
    lifecycle = require("../../data/user-lifecycle");
    lifecycle._reset(); // drop real (financial/resource) handlers; observe in isolation

    const UserDatabase = require("../../data/user-database");
    db = new UserDatabase();
  });

  it("createUser fires notifyUserCreated with the created user", async () => {
    const created = { id: 123, email: "probe@test.com", displayedName: "Probe" };
    db.db.add = vi.fn().mockResolvedValue(created);

    const handler = vi.fn();
    lifecycle.onUserCreated("probe:create", handler);

    const result = await db.createUser({ email: "probe@test.com", displayedName: "Probe", password: "x" });

    expect(result).toEqual(created);
    expect(handler).toHaveBeenCalledWith(created);
  });

  it("createUser still succeeds if a create handler throws (best-effort cascade)", async () => {
    const created = { id: 5, email: "p2@test.com" };
    db.db.add = vi.fn().mockResolvedValue(created);
    lifecycle.onUserCreated("probe:boom", vi.fn().mockRejectedValue(new Error("financial init failed")));

    await expect(db.createUser({ email: "p2@test.com", password: "x" })).resolves.toEqual(created);
  });

  it("deleteUser fires notifyUserDeleted with the deleted user", async () => {
    const existing = { id: 9, email: "del@test.com" };
    db.db.findOne = vi.fn().mockResolvedValue(existing);
    db.db.remove = vi.fn().mockResolvedValue(undefined);

    const handler = vi.fn();
    lifecycle.onUserDeleted("probe:delete", handler);

    const result = await db.deleteUser(9);

    expect(result).toEqual(existing);
    expect(handler).toHaveBeenCalledWith(existing);
  });

  it("deleteUser propagates a failing cascade (matches original semantics)", async () => {
    const existing = { id: 11, email: "del2@test.com" };
    db.db.findOne = vi.fn().mockResolvedValue(existing);
    db.db.remove = vi.fn().mockResolvedValue(undefined);
    lifecycle.onUserDeleted("probe:boom-del", vi.fn().mockRejectedValue(new Error("cascade failed")));

    await expect(db.deleteUser(11)).rejects.toThrow("cascade failed");
  });
});
