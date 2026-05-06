const dbManager = require("../data/database-manager");

const DEFAULT_USER_AVATAR_DATA = {
  version: 1,
  avatars: [],
  updatedAt: null,
};

class UserAvatarStorageService {
  constructor() {
    this.db = dbManager.getUserAvatarsDatabase();
  }

  _normalize(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ...DEFAULT_USER_AVATAR_DATA };
    }

    return {
      version: Number.isInteger(data.version) ? data.version : 1,
      avatars: Array.isArray(data.avatars) ? data.avatars.filter((item) => item && typeof item === "object") : [],
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    };
  }

  async getAvatarByUserId(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return null;
    }

    const data = this._normalize(await this.db.getAll());
    return data.avatars.find((item) => Number(item.userId) === numericUserId) || null;
  }

  async upsertAvatar(userId, avatarDataUrl, avatarUpdatedAt = new Date().toISOString()) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      throw new Error("Invalid user ID format");
    }

    if (typeof avatarDataUrl !== "string" || !avatarDataUrl.trim()) {
      throw new Error("Avatar data is required");
    }

    const nextAvatar = {
      userId: numericUserId,
      avatarDataUrl: avatarDataUrl.trim(),
      avatarUpdatedAt,
    };

    await this.db.update((current) => {
      const normalized = this._normalize(current);
      const existingIndex = normalized.avatars.findIndex((item) => Number(item.userId) === numericUserId);

      if (existingIndex >= 0) {
        normalized.avatars[existingIndex] = nextAvatar;
      } else {
        normalized.avatars.push(nextAvatar);
      }

      normalized.updatedAt = new Date().toISOString();
      return normalized;
    });

    return nextAvatar;
  }

  async removeAvatar(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return false;
    }

    let removed = false;
    await this.db.update((current) => {
      const normalized = this._normalize(current);
      const nextAvatars = normalized.avatars.filter((item) => Number(item.userId) !== numericUserId);
      removed = nextAvatars.length !== normalized.avatars.length;

      return {
        ...normalized,
        avatars: nextAvatars,
        updatedAt: removed ? new Date().toISOString() : normalized.updatedAt,
      };
    });

    return removed;
  }
}

module.exports = new UserAvatarStorageService();
