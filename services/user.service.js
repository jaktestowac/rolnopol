const UserDataSingleton = require("../data/user-data-singleton");
const { validateProfileUpdateData } = require("../helpers/validators");
const { logDebug, logError } = require("../helpers/logger-api");

class UserService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      logError("User profile retrieval failed", {
        userId,
        reason: "User not found",
      });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User profile retrieval failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    // Remove password from response
    const { password, ...userResponse } = user;

    return userResponse;
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updateData) {
    logDebug("Updating user profile", { userId, updateData });
    const { displayedName, email, password } = updateData;

    // Trim displayedName before validation
    const trimmedDisplayedName = displayedName ? displayedName.trim() : displayedName;

    // Validate input data
    const validation = validateProfileUpdateData({
      displayedName: trimmedDisplayedName,
      email,
      password,
    });
    if (!validation.isValid) {
      logError("User profile update failed", {
        userId,
        reason: "Validation failed",
        errors: validation.errors,
      });
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Check if user exists and is active
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      logError("User profile update failed", {
        userId,
        reason: "User not found",
      });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User profile update failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    const dataToUpdate = {};

    // Check if email is being changed and if it's already taken
    if (email && email !== user.email) {
      const existingUser = await this.userDataInstance.findUserByEmail(email);
      if (existingUser) {
        logError("User profile update failed", {
          userId,
          reason: "Email already in use",
        });
        throw new Error("Email already in use");
      }
      dataToUpdate.email = email;
    }

    // Update other fields - only if they are not empty after trimming
    if (trimmedDisplayedName && trimmedDisplayedName.length > 0) dataToUpdate.displayedName = trimmedDisplayedName;
    if (password) dataToUpdate.password = password; // Plain text password

    // Update user
    const updatedUser = await this.userDataInstance.updateUser(userId, dataToUpdate);

    // Remove password from response
    const { password: _, ...userResponse } = updatedUser;

    logDebug("User profile updated successfully", { userId });

    return userResponse;
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    const users = await this.userDataInstance.getAllUsers();

    // Remove passwords from all users
    return users.map((user) => {
      const { password, ...userResponse } = user;
      return userResponse;
    });
  }

  /**
   * Get user count
   */
  async getUserCount() {
    return await this.userDataInstance.getUserCount();
  }

  /**
   * Delete user profile
   */
  async deleteUserProfile(userId) {
    // Check if user exists and is active
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      logError("User deletion failed", { userId, reason: "User not found" });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User deletion failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    // Delete user
    const deletedUser = await this.userDataInstance.deleteUser(userId);

    // Remove password from response
    const { password, ...userResponse } = deletedUser;

    logDebug("User profile deleted successfully", { userId });

    return userResponse;
  }

  _normalizeIdList(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const normalized = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);

    return [...new Set(normalized)];
  }

  _toPublicUserSummary(user) {
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username || null,
      displayedName: user.displayedName || null,
      email: user.email || null,
      isActive: user.isActive === true,
    };
  }

  async _getActiveUserOrThrow(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isActive) {
      throw new Error("Account is deactivated");
    }

    return user;
  }

  async _resolveUserByIdentifier(identifier) {
    const normalizedIdentifier = typeof identifier === "string" ? identifier.trim() : "";

    if (!normalizedIdentifier) {
      throw new Error("Validation failed: identifier is required");
    }

    let candidate = null;

    if (normalizedIdentifier.includes("@")) {
      candidate = await this.userDataInstance.findUserByEmail(normalizedIdentifier);
    }

    if (!candidate) {
      candidate = await this.userDataInstance.findUserByUsername(normalizedIdentifier);
    }

    if (!candidate) {
      throw new Error("Target user not found");
    }

    if (!candidate.isActive) {
      throw new Error("Target user is deactivated");
    }

    return candidate;
  }

  async addFriend(userId, identifier) {
    const user = await this._getActiveUserOrThrow(userId);
    const targetUser = await this._resolveUserByIdentifier(identifier);

    if (user.id === targetUser.id) {
      throw new Error("Validation failed: You cannot add yourself as a friend");
    }

    const userFriends = this._normalizeIdList(user.friends);
    if (userFriends.includes(targetUser.id)) {
      throw new Error("Friend already added");
    }

    const nextUserFriends = [...userFriends, targetUser.id];
    await this.userDataInstance.updateUser(user.id, { friends: nextUserFriends });

    const targetFriends = this._normalizeIdList(targetUser.friends);
    if (!targetFriends.includes(user.id)) {
      await this.userDataInstance.updateUser(targetUser.id, {
        friends: [...targetFriends, user.id],
      });
    }

    return {
      friend: this._toPublicUserSummary(targetUser),
      count: nextUserFriends.length,
    };
  }

  async listFriends(userId) {
    const user = await this._getActiveUserOrThrow(userId);
    const friendIds = this._normalizeIdList(user.friends);
    const blockedByCurrentUser = this._normalizeIdList(user.blockedUsers);

    const friends = [];
    for (const friendId of friendIds) {
      const friend = await this.userDataInstance.findUser(friendId);
      if (!friend || !friend.isActive) {
        continue;
      }

      const blockedByFriend = this._normalizeIdList(friend.blockedUsers);
      const blockedByYou = blockedByCurrentUser.includes(friend.id);
      const blockedByThem = blockedByFriend.includes(user.id);

      friends.push({
        ...this._toPublicUserSummary(friend),
        blockedByYou,
        blockedByThem,
        isBlocked: blockedByYou || blockedByThem,
      });
    }

    return friends;
  }

  async removeFriend(userId, friendUserId) {
    const user = await this._getActiveUserOrThrow(userId);
    const friend = await this._getActiveUserOrThrow(friendUserId);

    const userFriends = this._normalizeIdList(user.friends);
    if (!userFriends.includes(friend.id)) {
      throw new Error("Friend not found");
    }

    const nextUserFriends = userFriends.filter((id) => id !== friend.id);
    await this.userDataInstance.updateUser(user.id, { friends: nextUserFriends });

    return {
      removedFriendId: friend.id,
      count: nextUserFriends.length,
    };
  }

  async listBlockedUsers(userId) {
    const user = await this._getActiveUserOrThrow(userId);
    const blockedIds = this._normalizeIdList(user.blockedUsers);

    const blockedUsers = [];
    for (const blockedId of blockedIds) {
      const blockedUser = await this.userDataInstance.findUser(blockedId);
      if (!blockedUser || !blockedUser.isActive) {
        continue;
      }
      blockedUsers.push(this._toPublicUserSummary(blockedUser));
    }

    return blockedUsers;
  }

  async blockUser(userId, payload = {}) {
    const user = await this._getActiveUserOrThrow(userId);
    const identifier = payload?.identifier;
    const explicitTargetUserId = payload?.userId;

    let targetUser;
    if (explicitTargetUserId !== undefined && explicitTargetUserId !== null) {
      targetUser = await this._getActiveUserOrThrow(explicitTargetUserId);
    } else {
      targetUser = await this._resolveUserByIdentifier(identifier);
    }

    if (user.id === targetUser.id) {
      throw new Error("Validation failed: You cannot block yourself");
    }

    const blockedIds = this._normalizeIdList(user.blockedUsers);
    if (blockedIds.includes(targetUser.id)) {
      throw new Error("User already blocked");
    }

    const nextBlockedIds = [...blockedIds, targetUser.id];
    await this.userDataInstance.updateUser(user.id, { blockedUsers: nextBlockedIds });

    return {
      blockedUser: this._toPublicUserSummary(targetUser),
      count: nextBlockedIds.length,
    };
  }

  async unblockUser(userId, blockedUserId) {
    const user = await this._getActiveUserOrThrow(userId);
    const blockedUser = await this._getActiveUserOrThrow(blockedUserId);

    const blockedIds = this._normalizeIdList(user.blockedUsers);
    if (!blockedIds.includes(blockedUser.id)) {
      throw new Error("Blocked user not found");
    }

    const nextBlockedIds = blockedIds.filter((id) => id !== blockedUser.id);
    await this.userDataInstance.updateUser(user.id, { blockedUsers: nextBlockedIds });

    return {
      unblockedUserId: blockedUser.id,
      count: nextBlockedIds.length,
    };
  }
}

module.exports = new UserService();
