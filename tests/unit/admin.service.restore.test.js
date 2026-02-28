import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import adminService from "../../services/admin.service.js";

describe("admin.service restoreDatabase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses user.id fallback when user.userId is missing during cleanup", async () => {
    vi.spyOn(adminService.userDataInstance, "getUsers").mockResolvedValue([{ id: 99 }]);
    const deleteSpy = vi.spyOn(adminService.userDataInstance, "deleteUser").mockResolvedValue();
    vi.spyOn(adminService.userDataInstance, "createUser").mockResolvedValue({ id: 1 });

    await adminService.restoreDatabase({ users: [{ id: 1, email: "u1@test.dev" }] });

    expect(deleteSpy).toHaveBeenCalledWith(99);
  });

  it("reports restoredCount accurately when some restores fail", async () => {
    vi.spyOn(adminService.userDataInstance, "getUsers").mockResolvedValue([{ userId: 1 }]);
    vi.spyOn(adminService.userDataInstance, "deleteUser").mockResolvedValue();

    const createSpy = vi
      .spyOn(adminService.userDataInstance, "createUser")
      .mockResolvedValueOnce({ id: 10 })
      .mockRejectedValueOnce(new Error("broken user"))
      .mockResolvedValueOnce({ id: 30 });

    const backupData = {
      users: [
        { id: 10, email: "a@test.dev" },
        { id: 20, email: "b@test.dev" },
        { id: 30, email: "c@test.dev" },
      ],
    };

    const result = await adminService.restoreDatabase(backupData);

    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(result.restoredCount).toBe(2);
    expect(result.totalInBackup).toBe(3);
  });
});
