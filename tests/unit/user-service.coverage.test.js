import userService from "../../services/user.service.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const userAvatarStorageService = require("../../services/user-avatar-storage.service.js");
const messengerEventsService = require("../../services/messenger-events.service.js");

describe("user.service (coverage)", () => {
  let userDataInstance;

  beforeEach(() => {
    userDataInstance = userService.userDataInstance;
    vi.spyOn(messengerEventsService, "emitRelationshipChanged").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserProfile (real implementation)", () => {
    it("throws when the user does not exist", async () => {
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(null);
      await expect(userService.getUserProfile(1)).rejects.toThrow("User not found");
    });

    it("throws when the account is deactivated", async () => {
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue({ id: 1, isActive: false });
      await expect(userService.getUserProfile(1)).rejects.toThrow("Account is deactivated");
    });

    it("returns the public profile without a password when no avatar exists", async () => {
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue({
        id: 1,
        username: "farmer",
        password: "secret",
        isActive: true,
      });
      vi.spyOn(userAvatarStorageService, "getAvatarByUserId").mockResolvedValue(null);

      const result = await userService.getUserProfile(1);
      expect(result).toMatchObject({ id: 1, username: "farmer" });
      expect(result).not.toHaveProperty("password");
      expect(result).not.toHaveProperty("avatarDataUrl");
    });
  });

  describe("updateUserAvatar validation", () => {
    it("throws when the upload is invalid", async () => {
      await expect(userService.updateUserAvatar(1, Buffer.from("not-an-image"), "text/plain")).rejects.toThrow("Validation failed");
    });

    it("throws when the user is not found", async () => {
      const buffer = buildPngBuffer();
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(null);
      await expect(userService.updateUserAvatar(1, buffer, "image/png")).rejects.toThrow("User not found");
    });

    it("throws when the account is deactivated", async () => {
      const buffer = buildPngBuffer();
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue({ id: 1, isActive: false });
      await expect(userService.updateUserAvatar(1, buffer, "image/png")).rejects.toThrow("Account is deactivated");
    });
  });

  describe("_normalizeIdList", () => {
    it("coerces, dedupes and drops invalid ids", () => {
      expect(userService._normalizeIdList(["1", 2, 2, -3, 0, "abc", 4.2])).toEqual([1, 2]);
    });

    it("returns an empty array for non-array input", () => {
      expect(userService._normalizeIdList(null)).toEqual([]);
      expect(userService._normalizeIdList(undefined)).toEqual([]);
    });
  });

  describe("_toPublicUserSummary", () => {
    it("returns null for a falsy user", () => {
      expect(userService._toPublicUserSummary(null)).toBeNull();
    });

    it("maps the summary fields with defaults", () => {
      expect(userService._toPublicUserSummary({ id: 5, username: "u", isActive: true })).toEqual({
        id: 5,
        username: "u",
        displayedName: null,
        email: null,
        isActive: true,
      });
    });
  });

  describe("addFriend", () => {
    it("adds a mutual friendship and returns the summary + count", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      const target = { id: 2, isActive: true, username: "bob", friends: [] };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : null));
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue(target);
      const updateSpy = vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.addFriend(1, "bob");

      expect(result.friend).toMatchObject({ id: 2, username: "bob" });
      expect(result.count).toBe(1);
      // Both sides of the friendship are persisted.
      expect(updateSpy).toHaveBeenCalledWith(1, { friends: [2] });
      expect(updateSpy).toHaveBeenCalledWith(2, { friends: [1] });
      expect(messengerEventsService.emitRelationshipChanged).toHaveBeenCalled();
    });

    it("resolves the target by email when the identifier contains '@'", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      const target = { id: 2, isActive: true, email: "bob@farm.io", friends: [1] };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : null));
      const byEmail = vi.spyOn(userDataInstance, "findUserByEmail").mockResolvedValue(target);
      vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.addFriend(1, "bob@farm.io");
      expect(byEmail).toHaveBeenCalledWith("bob@farm.io");
      expect(result.count).toBe(1);
    });

    it("rejects adding yourself", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(acting);
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue(acting);
      await expect(userService.addFriend(1, "self")).rejects.toThrow("cannot add yourself");
    });

    it("rejects a duplicate friendship", async () => {
      const acting = { id: 1, isActive: true, friends: [2] };
      const target = { id: 2, isActive: true, friends: [1] };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : null));
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue(target);
      await expect(userService.addFriend(1, "bob")).rejects.toThrow("Friend already added");
    });

    it("rejects when the target cannot be resolved", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(acting);
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue(null);
      await expect(userService.addFriend(1, "ghost")).rejects.toThrow("Target user not found");
    });

    it("rejects when the target is deactivated", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(acting);
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue({ id: 2, isActive: false });
      await expect(userService.addFriend(1, "bob")).rejects.toThrow("Target user is deactivated");
    });

    it("rejects a blank identifier", async () => {
      const acting = { id: 1, isActive: true, friends: [] };
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(acting);
      await expect(userService.addFriend(1, "   ")).rejects.toThrow("identifier is required");
    });
  });

  describe("listFriends", () => {
    it("returns active friends and skips missing/inactive ones", async () => {
      const acting = { id: 1, isActive: true, friends: [2, 3, 4], blockedUsers: [] };
      const friend2 = { id: 2, isActive: true, username: "b2", blockedUsers: [] };
      const friend4 = { id: 4, isActive: true, username: "b4", blockedUsers: [1] }; // blocked the current user
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => {
        if (Number(id) === 1) return acting;
        if (Number(id) === 2) return friend2;
        if (Number(id) === 3) return null; // missing
        if (Number(id) === 4) return friend4;
        return null;
      });
      vi.spyOn(userAvatarStorageService, "getAvatarByUserId").mockResolvedValue(null);

      const result = await userService.listFriends(1);
      expect(result.map((f) => f.id)).toEqual([2, 4]);
      const blockedFriend = result.find((f) => f.id === 4);
      expect(blockedFriend.blockedByThem).toBe(true);
      expect(blockedFriend.isBlocked).toBe(true);
    });
  });

  describe("removeFriend", () => {
    it("removes an existing friend and returns the new count", async () => {
      const acting = { id: 1, isActive: true, friends: [2, 3] };
      const friend = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : friend));
      const updateSpy = vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.removeFriend(1, 2);
      expect(result).toEqual({ removedFriendId: 2, count: 1 });
      expect(updateSpy).toHaveBeenCalledWith(1, { friends: [3] });
    });

    it("rejects removing someone who is not a friend", async () => {
      const acting = { id: 1, isActive: true, friends: [3] };
      const friend = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : friend));
      await expect(userService.removeFriend(1, 2)).rejects.toThrow("Friend not found");
    });
  });

  describe("blockUser / unblockUser / listBlockedUsers", () => {
    it("blocks a user resolved by identifier", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [] };
      const target = { id: 2, isActive: true, username: "bob" };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : null));
      vi.spyOn(userDataInstance, "findUserByUsername").mockResolvedValue(target);
      const updateSpy = vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.blockUser(1, { identifier: "bob" });
      expect(result.blockedUser).toMatchObject({ id: 2 });
      expect(result.count).toBe(1);
      expect(updateSpy).toHaveBeenCalledWith(1, { blockedUsers: [2] });
    });

    it("blocks a user resolved by explicit userId", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [] };
      const target = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : target));
      vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.blockUser(1, { userId: 2 });
      expect(result.count).toBe(1);
    });

    it("rejects blocking yourself", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [] };
      vi.spyOn(userDataInstance, "findUser").mockResolvedValue(acting);
      await expect(userService.blockUser(1, { userId: 1 })).rejects.toThrow("cannot block yourself");
    });

    it("rejects blocking an already-blocked user", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [2] };
      const target = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : target));
      await expect(userService.blockUser(1, { userId: 2 })).rejects.toThrow("already blocked");
    });

    it("unblocks a blocked user", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [2, 3] };
      const target = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : target));
      const updateSpy = vi.spyOn(userDataInstance, "updateUser").mockResolvedValue({});

      const result = await userService.unblockUser(1, 2);
      expect(result).toEqual({ unblockedUserId: 2, count: 1 });
      expect(updateSpy).toHaveBeenCalledWith(1, { blockedUsers: [3] });
    });

    it("rejects unblocking a user who is not blocked", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [3] };
      const target = { id: 2, isActive: true };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => (Number(id) === 1 ? acting : target));
      await expect(userService.unblockUser(1, 2)).rejects.toThrow("Blocked user not found");
    });

    it("lists active blocked users and skips inactive/missing ones", async () => {
      const acting = { id: 1, isActive: true, blockedUsers: [2, 3, 4] };
      vi.spyOn(userDataInstance, "findUser").mockImplementation(async (id) => {
        if (Number(id) === 1) return acting;
        if (Number(id) === 2) return { id: 2, isActive: true, username: "b2" };
        if (Number(id) === 3) return null;
        if (Number(id) === 4) return { id: 4, isActive: false };
        return null;
      });

      const result = await userService.listBlockedUsers(1);
      expect(result.map((u) => u.id)).toEqual([2]);
    });
  });
});

// Minimal valid 1x1 PNG header so validateAvatarUpload accepts the buffer.
function buildPngBuffer() {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, 4, "ascii");
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  return buffer;
}
