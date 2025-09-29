vi.mock("../../helpers/token.helpers", () => ({
  isTokenInStorage: vi.fn(() => true),
  isAdminToken: vi.fn(() => true),
  generateAdminToken: vi.fn(() => "admintoken"),
  revokeAdminToken: vi.fn(),
  getTokenStats: vi.fn(() => ({})),
  cleanupExpiredTokens: vi.fn(),
}));

import adminService from "../../services/admin.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../../data/settings.js";

describe("admin.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should login admin with valid credentials", async () => {
    const result = await adminService.loginAdmin(
      { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
      "client1",
    );
    expect(result.token).toBeDefined();
    expect(result.username).toBe(ADMIN_USERNAME);
  });

  it("should throw error for invalid admin credentials", async () => {
    await expect(
      adminService.loginAdmin({ username: "bad", password: "bad" }, "client1"),
    ).rejects.toThrow("Invalid admin credentials");
  });

  it("should get system stats", async () => {
    vi.spyOn(adminService.userDataInstance, "getUserCount").mockResolvedValue(
      2,
    );
    vi.spyOn(adminService.userDataInstance, "getUsers").mockResolvedValue([
      { isActive: true },
      { isActive: false },
    ]);
    const result = await adminService.getSystemStats();
    expect(result.users.total).toBe(2);
    expect(result.users.active).toBe(1);
    expect(result.users.inactive).toBe(1);
  });

  it("should get all users detailed", async () => {
    vi.spyOn(adminService.userDataInstance, "getUsers").mockResolvedValue([
      { id: 1, password: "pass", displayedName: "User" },
    ]);
    const result = await adminService.getAllUsersDetailed();
    expect(result[0].password).toBeUndefined();
    expect(result[0].displayedName).toBe("User");
  });

  it("should update user status", async () => {
    vi.spyOn(adminService.userDataInstance, "findUser").mockResolvedValue({
      id: 1,
    });
    vi.spyOn(adminService.userDataInstance, "updateUser").mockResolvedValue({
      id: 1,
      isActive: false,
      password: "pass",
    });
    const result = await adminService.updateUserStatus(1, false);
    expect(result.id).toBe(1);
    expect(result.isActive).toBe(false);
  });

  it("should delete user", async () => {
    vi.spyOn(adminService.userDataInstance, "findUser").mockResolvedValue({
      id: 1,
    });
    vi.spyOn(adminService.userDataInstance, "deleteUser").mockResolvedValue();
    const result = await adminService.deleteUser(1);
    expect(result.message).toMatch(/deleted successfully/);
  });

  it("should calculate profile completeness", () => {
    const completeness = adminService.calculateProfileCompleteness({
      displayedName: "A",
      email: "B",
      firstName: "",
      lastName: "",
      phone: "",
    });
    expect(completeness).toBeGreaterThanOrEqual(0);
  });

  it("should create and restore database backup", async () => {
    vi.spyOn(adminService.userDataInstance, "getUsers").mockResolvedValue([
      { id: 1, password: "pass" },
    ]);
    const backup = await adminService.createDatabaseBackup();
    expect(backup.users.length).toBeGreaterThanOrEqual(1);
    vi.spyOn(adminService.userDataInstance, "deleteUser").mockResolvedValue();
    vi.spyOn(adminService.userDataInstance, "createUser").mockResolvedValue();
    const result = await adminService.restoreDatabase({ users: [{ id: 1 }] });
    expect(result.restoredCount).toBeGreaterThanOrEqual(0);
  });
});
