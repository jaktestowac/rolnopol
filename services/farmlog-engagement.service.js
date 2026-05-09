const dbManager = require("../data/database-manager");
const { publishNotificationEvent } = require("../middleware/notification-publisher.middleware");
const { EVENT_TYPES } = require("../modules/notification-center/core/contracts");

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_WINDOWS = {
  "1d": DAY_MS,
  "7d": 7 * DAY_MS,
  "14d": 14 * DAY_MS,
  "30d": 30 * DAY_MS,
  "1y": 365 * DAY_MS,
  all: null,
};

const PERIOD_ALIASES = {
  day: "1d",
  "1-day": "1d",
  "7days": "7d",
  "7-days": "7d",
  "14days": "14d",
  "14-days": "14d",
  "30days": "30d",
  "30-days": "30d",
  year: "1y",
  "365d": "1y",
  "all-time": "all",
  alltime: "all",
};

class FarmlogEngagementService {
  constructor() {
    this.blogsDb = dbManager.getBlogsDatabase();
    this.postsDb = dbManager.getPostsDatabase();
    this.postLikesDb = dbManager.getPostLikesDatabase();
    this.favoritesDb = dbManager.getFarmlogFavoritesDatabase();
  }

  normalizePeriod(period) {
    const normalized = String(period || "all")
      .trim()
      .toLowerCase();
    const mapped = PERIOD_WINDOWS[normalized] !== undefined ? normalized : PERIOD_ALIASES[normalized];
    return PERIOD_WINDOWS[mapped] !== undefined ? mapped : "all";
  }

  _normalizeTargetType(targetType) {
    return String(targetType || "")
      .trim()
      .toLowerCase() === "blog"
      ? "blog"
      : "post";
  }

  _matchesId(left, right) {
    const leftNumeric = Number(left);
    const rightNumeric = Number(right);

    if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
      return leftNumeric === rightNumeric;
    }

    return String(left) === String(right);
  }

  _getTimestamp(value) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  _getCutoffTimestamp(period) {
    const normalizedPeriod = this.normalizePeriod(period);
    const windowMs = PERIOD_WINDOWS[normalizedPeriod];
    return windowMs == null ? null : Date.now() - windowMs;
  }

  _isWithinPeriod(record, cutoffTimestamp) {
    return cutoffTimestamp == null || this._getTimestamp(record?.createdAt) >= cutoffTimestamp;
  }

  _buildFavoriteLookup(favorites, currentUserId, targetType) {
    if (currentUserId == null) {
      return new Set();
    }

    const normalizedTargetType = this._normalizeTargetType(targetType);
    return new Set(
      favorites
        .filter((favorite) => String(favorite.userId) === String(currentUserId) && favorite.targetType === normalizedTargetType)
        .map((favorite) => `${favorite.targetType}:${String(favorite.targetId)}`),
    );
  }

  async enrichBlogs(blogs, currentUserId = null) {
    const items = Array.isArray(blogs) ? blogs : [];
    if (items.length === 0) {
      return [];
    }

    const favorites = await this.favoritesDb.getAll();
    const favoriteLookup = this._buildFavoriteLookup(favorites, currentUserId, "blog");

    return items.map((blog) => ({
      ...blog,
      favoritedByCurrentUser: favoriteLookup.has(`blog:${String(blog.id)}`),
    }));
  }

  async enrichPosts(posts, currentUserId = null, options = {}) {
    const items = Array.isArray(posts) ? posts : [];
    if (items.length === 0) {
      return [];
    }

    const period = this.normalizePeriod(options.period);
    const cutoffTimestamp = this._getCutoffTimestamp(period);
    const [likes, favorites, blogs] = await Promise.all([this.postLikesDb.getAll(), this.favoritesDb.getAll(), this.blogsDb.getAll()]);

    const likeCounts = new Map();
    const periodLikeCounts = new Map();
    const likedByCurrentUser = new Set();

    for (const like of likes) {
      const postKey = String(like.postId);
      likeCounts.set(postKey, (likeCounts.get(postKey) || 0) + 1);

      if (this._isWithinPeriod(like, cutoffTimestamp)) {
        periodLikeCounts.set(postKey, (periodLikeCounts.get(postKey) || 0) + 1);
      }

      if (currentUserId != null && String(like.userId) === String(currentUserId)) {
        likedByCurrentUser.add(postKey);
      }
    }

    const favoriteLookup = this._buildFavoriteLookup(favorites, currentUserId, "post");
    const blogsById = new Map(blogs.map((blog) => [String(blog.id), blog]));

    return items.map((post) => {
      const postKey = String(post.id);
      const blog = blogsById.get(String(post.blogId));
      const likesCount = likeCounts.get(postKey) || 0;
      const normalizedPeriodLikesCount = periodLikeCounts.get(postKey) || 0;

      return {
        ...post,
        blogSlug: post.blogSlug || blog?.slug || null,
        blogTitle: post.blogTitle || blog?.title || null,
        likesCount,
        periodLikesCount: period === "all" ? likesCount : normalizedPeriodLikesCount,
        likedByCurrentUser: likedByCurrentUser.has(postKey),
        favoritedByCurrentUser: favoriteLookup.has(`post:${postKey}`),
      };
    });
  }

  async likePost(userId, post) {
    const existingLike = await this.postLikesDb.findOne(
      (item) => String(item.userId) === String(userId) && this._matchesId(item.postId, post.id),
    );

    if (existingLike) {
      return existingLike;
    }

    const now = new Date().toISOString();
    const added = await this.postLikesDb.add({
      userId,
      postId: post.id,
      blogId: post.blogId,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const postRecord = await this.postsDb.findOne((p) => p.id === added.postId);
      const authorId = postRecord?.userId ?? null;

      publishNotificationEvent(
        {
          type: EVENT_TYPES.FARMLOG_POST_LIKED,
          payload: {
            postId: added.postId,
            blogId: added.blogId,
            likedByUserId: Number(userId),
            likeId: added.id,
            occurredAt: added.createdAt,
            authorId,
          },
          correlationId: `farmlog-post-liked-${added.id}`,
          source: "farmlog-engagement.service",
        },
        {
          action: "farmlog_post_liked",
          meta: { userId: authorId != null ? Number(authorId) : null, postId: added.postId },
        },
      );
    } catch (e) {
      // best-effort
    }

    return added;
  }

  async unlikePost(userId, post) {
    await this.postLikesDb.remove((item) => String(item.userId) === String(userId) && this._matchesId(item.postId, post.id));
  }

  async favoriteBlog(userId, blog) {
    return this._favoriteEntity(userId, "blog", {
      id: blog.id,
      blogId: blog.id,
    });
  }

  async unfavoriteBlog(userId, blog) {
    return this._unfavoriteEntity(userId, "blog", {
      id: blog.id,
      blogId: blog.id,
    });
  }

  async favoritePost(userId, post) {
    return this._favoriteEntity(userId, "post", {
      id: post.id,
      blogId: post.blogId,
      postId: post.id,
    });
  }

  async unfavoritePost(userId, post) {
    return this._unfavoriteEntity(userId, "post", {
      id: post.id,
      blogId: post.blogId,
      postId: post.id,
    });
  }

  async _favoriteEntity(userId, targetType, entity) {
    const normalizedTargetType = this._normalizeTargetType(targetType);
    const existingFavorite = await this.favoritesDb.findOne(
      (item) =>
        String(item.userId) === String(userId) && item.targetType === normalizedTargetType && this._matchesId(item.targetId, entity.id),
    );

    if (existingFavorite) {
      return existingFavorite;
    }

    const now = new Date().toISOString();
    const added = await this.favoritesDb.add({
      userId,
      targetType: normalizedTargetType,
      targetId: entity.id,
      blogId: entity.blogId ?? null,
      postId: entity.postId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      if (normalizedTargetType === "post") {
        const postRecord = await this.postsDb.findOne((p) => p.id === added.postId);
        const authorId = postRecord?.userId ?? null;

        publishNotificationEvent(
          {
            type: EVENT_TYPES.FARMLOG_POST_FAVORITED,
            payload: {
              postId: added.postId,
              blogId: added.blogId,
              userId: Number(userId),
              favoriteId: added.id,
              occurredAt: added.createdAt,
              authorId,
            },
            correlationId: `farmlog-post-favorited-${added.id}`,
            source: "farmlog-engagement.service",
          },
          {
            action: "farmlog_post_favorited",
            meta: { userId: authorId != null ? Number(authorId) : null, postId: added.postId },
          },
        );
      }
    } catch (e) {
      // best-effort
    }

    return added;
  }

  async _unfavoriteEntity(userId, targetType, entity) {
    const normalizedTargetType = this._normalizeTargetType(targetType);
    await this.favoritesDb.remove(
      (item) =>
        String(item.userId) === String(userId) && item.targetType === normalizedTargetType && this._matchesId(item.targetId, entity.id),
    );
  }
}

module.exports = new FarmlogEngagementService();
