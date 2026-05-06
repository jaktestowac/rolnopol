import userService from "../../services/user.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

const userAvatarStorageService = require("../../services/user-avatar-storage.service.js");

describe("user.service", () => {
  let userDataInstance;

  beforeEach(() => {
    userDataInstance = userService.userDataInstance;
    vi.restoreAllMocks();
  });

  it("should call getUserProfile", async () => {
    const spy = vi.spyOn(userService, "getUserProfile").mockResolvedValue({ id: 1, username: "user" });
    const result = await userService.getUserProfile(1);
    expect(result).toEqual({ id: 1, username: "user" });
    expect(spy).toHaveBeenCalledWith(1);
    spy.mockRestore();
  });

  it("should throw error if updateUserProfile validation fails", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: true,
    });
    await expect(userService.updateUserProfile(1, { displayedName: "" })).rejects.toThrow("Validation failed");
  });

  it("should throw error if user not found", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue(null);
    await expect(userService.updateUserProfile(1, { displayedName: "Test User" })).rejects.toThrow("User not found");
  });

  it("should update user profile successfully", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: true,
      email: "old@example.com",
    });
    vi.spyOn(userDataInstance, "findUserByEmail").mockResolvedValue(null);
    vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({
      id: 1,
      displayedName: "Test",
      email: "new@example.com",
      isActive: true,
    });
    const result = await userService.updateUserProfile(1, {
      displayedName: "Test",
      email: "new@example.com",
      password: "pass",
    });
    expect(result).toMatchObject({
      id: 1,
      displayedName: "Test",
      email: "new@example.com",
      isActive: true,
    });
  });

  it("should throw error if email already in use", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: true,
      email: "old@example.com",
    });
    vi.spyOn(userDataInstance, "findUserByEmail").mockResolvedValue({ id: 2 });
    await expect(
      userService.updateUserProfile(1, {
        displayedName: "Test",
        email: "used@example.com",
        password: "pass",
      }),
    ).rejects.toThrow("Email already in use");
  });

  it("should throw error if user is inactive", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: false,
    });
    await expect(
      userService.updateUserProfile(1, {
        displayedName: "Test",
        email: "test@example.com",
        password: "pass",
      }),
    ).rejects.toThrow("Account is deactivated");
  });

  it("should get all users and remove passwords", async () => {
    userDataInstance.getAllUsers = vi.fn().mockResolvedValue([
      { id: 1, username: "user1", password: "pass1" },
      { id: 2, username: "user2", password: "pass2" },
    ]);
    const users = await userService.getAllUsers();
    expect(users).toEqual([
      { id: 1, username: "user1" },
      { id: 2, username: "user2" },
    ]);
  });

  it("should get user count", async () => {
    vi.spyOn(userDataInstance, "getUserCount").mockResolvedValue(5);
    const count = await userService.getUserCount();
    expect(count).toBe(5);
  });

  it("should delete user profile successfully", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: true,
      password: "pass",
    });
    vi.spyOn(userDataInstance, "deleteUser").mockResolvedValue({
      id: 1,
      username: "user1",
      password: "pass",
    });
    const result = await userService.deleteUserProfile(1);
    expect(result).toMatchObject({ id: 1, username: "user1" });
  });

  it("should throw error if user not found on delete", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue(null);
    await expect(userService.deleteUserProfile(1)).rejects.toThrow("User not found");
  });

  it("should throw error if user is inactive on delete", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: false,
    });
    await expect(userService.deleteUserProfile(1)).rejects.toThrow("Account is deactivated");
  });

  it("should merge avatar data from avatar storage into the user profile response", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      displayedName: "Demo User",
      email: "demo@example.com",
      password: "secret",
      isActive: true,
    });
    vi.spyOn(userAvatarStorageService, "getAvatarByUserId").mockResolvedValue({
      userId: 1,
      avatarDataUrl: "data:image/png;base64,abc123",
      avatarUpdatedAt: "2026-05-06T00:00:00.000Z",
    });

    const result = await userService.getUserProfile(1);

    expect(result).toMatchObject({
      id: 1,
      displayedName: "Demo User",
      avatarDataUrl: "data:image/png;base64,abc123",
      avatarUpdatedAt: "2026-05-06T00:00:00.000Z",
    });
    expect(result).not.toHaveProperty("password");
  });

  it("should store avatar data outside the user profile record", async () => {
    vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
      id: 1,
      isActive: true,
      email: "demo@example.com",
      displayedName: "Demo User",
    });
    vi.spyOn(userAvatarStorageService, "upsertAvatar").mockResolvedValue({
      userId: 1,
      avatarDataUrl: "data:image/png;base64,abc123",
      avatarUpdatedAt: "2026-05-06T00:00:00.000Z",
    });

    const buffer = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, 4, "ascii");
    buffer.writeUInt32BE(1, 16);
    buffer.writeUInt32BE(1, 20);

    const result = await userService.updateUserAvatar(1, buffer, "image/png");

    expect(userAvatarStorageService.upsertAvatar).toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 1,
      avatarDataUrl: "data:image/png;base64,abc123",
      avatarUpdatedAt: "2026-05-06T00:00:00.000Z",
    });
  });
});
