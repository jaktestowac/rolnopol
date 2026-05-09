const dbManager = require("../data/database-manager");
const blogService = require("./blog.service");
const UserDataSingleton = require("../data/user-data-singleton");
const farmlogEngagementService = require("./farmlog-engagement.service");
const { publishNotificationEvent } = require("../middleware/notification-publisher.middleware");
const { EVENT_TYPES } = require("../modules/notification-center/core/contracts");

class PostService {
  constructor() {
    this.postsDb = dbManager.getPostsDatabase();
  }

  _isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  _normalizeSlug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  _normalizeSort(sort) {
    const normalized = String(sort || "newest")
      .trim()
      .toLowerCase();
    return ["newest", "oldest", "title-asc", "title-desc", "most-liked"].includes(normalized) ? normalized : "newest";
  }

  _sortRawPosts(posts, sort) {
    const sorted = [...posts];
    const normalizedSort = this._normalizeSort(sort);

    if (normalizedSort === "oldest") {
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (normalizedSort === "title-asc") {
      sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    } else if (normalizedSort === "title-desc") {
      sorted.sort((a, b) => String(b.title || "").localeCompare(String(a.title || "")));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return sorted;
  }

  _sortEnrichedPosts(posts, sort) {
    const normalizedSort = this._normalizeSort(sort);
    if (normalizedSort !== "most-liked") {
      return this._sortRawPosts(posts, normalizedSort);
    }

    return [...posts].sort((a, b) => {
      const periodDelta = (b.periodLikesCount || 0) - (a.periodLikesCount || 0);
      if (periodDelta !== 0) return periodDelta;

      const totalDelta = (b.likesCount || 0) - (a.likesCount || 0);
      if (totalDelta !== 0) return totalDelta;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async _enrichPosts(posts, currentUserId = null, options = {}) {
    const items = Array.isArray(posts) ? posts : [];
    const userDataInstance = UserDataSingleton.getInstance();
    const blogs = await dbManager.getBlogsDatabase().getAll();
    const blogsById = new Map(blogs.map((blog) => [String(blog.id), blog]));

    const enrichedPosts = await Promise.all(
      items.map(async (post) => {
        const blog = blogsById.get(String(post.blogId));

        try {
          const user = await userDataInstance.findUser(post.userId);
          return {
            ...post,
            authorName: user?.displayedName || user?.email || "Anonymous",
            blogSlug: post.blogSlug || blog?.slug || null,
            blogTitle: post.blogTitle || blog?.title || null,
          };
        } catch {
          return {
            ...post,
            authorName: "Anonymous",
            blogSlug: post.blogSlug || blog?.slug || null,
            blogTitle: post.blogTitle || blog?.title || null,
          };
        }
      }),
    );

    if (options.includeEngagement === true) {
      return farmlogEngagementService.enrichPosts(enrichedPosts, currentUserId, { period: options.period });
    }

    return enrichedPosts;
  }

  _validatePostData(data, options = {}) {
    const errors = [];
    const allowPartial = options.allowPartial === true;
    const sanitized = {};

    if (!this._isPlainObject(data)) {
      errors.push("Post data must be an object");
      return { isValid: false, errors, sanitized };
    }

    if (!allowPartial || data.title !== undefined) {
      if (typeof data.title !== "string" || data.title.trim().length === 0) {
        errors.push("Post title is required");
      } else {
        const trimmedTitle = data.title.trim();
        if (trimmedTitle.length < 3 || trimmedTitle.length > 255) {
          errors.push("Post title must be between 3 and 255 characters");
        } else {
          sanitized.title = trimmedTitle;
        }
      }
    }

    if (!allowPartial || data.content !== undefined) {
      if (typeof data.content !== "string" || data.content.trim().length === 0) {
        errors.push("Post content is required");
      } else {
        const trimmedContent = data.content.trim();
        if (trimmedContent.length > 5000) {
          errors.push("Post content must be 5000 characters or fewer");
        } else {
          sanitized.content = trimmedContent;
        }
      }
    }

    if (data.slug !== undefined) {
      if (typeof data.slug !== "string" || this._normalizeSlug(data.slug).length === 0) {
        errors.push("Slug must be a valid non-empty string");
      } else {
        sanitized.slug = this._normalizeSlug(data.slug);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  async _ensureUniqueSlug(blogId, slug, excludeId = null) {
    const posts = await this.postsDb.getAll();
    let candidate = slug;
    let suffix = 1;

    while (posts.some((post) => post.blogId === blogId && post.deletedAt == null && post.slug === candidate && post.id !== excludeId)) {
      suffix += 1;
      candidate = `${slug}-${suffix}`;
    }

    return candidate;
  }

  async listPosts(blogSlug, currentUserId, limit, offset, options = {}) {
    const blog = await blogService.getBlogBySlug(blogSlug, currentUserId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const normalizedSort = this._normalizeSort(options.sort);
    const posts = await this.postsDb.getAll();
    const results = posts.filter((post) => post.blogId === blog.id && post.deletedAt == null);

    if (normalizedSort === "most-liked" && options.includeEngagement === true) {
      const enrichedResults = await this._enrichPosts(results, currentUserId, options);
      const sortedResults = this._sortEnrichedPosts(enrichedResults, normalizedSort);
      return normalizedLimit === null
        ? sortedResults.slice(normalizedOffset)
        : sortedResults.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    }

    const sortedResults = this._sortRawPosts(results, normalizedSort);

    const paginatedResults =
      normalizedLimit === null
        ? sortedResults.slice(normalizedOffset)
        : sortedResults.slice(normalizedOffset, normalizedOffset + normalizedLimit);

    return this._enrichPosts(paginatedResults, currentUserId, options);
  }

  async searchPosts({ search, currentUserId = null, limit, offset, sort = "newest", period = "all", includeEngagement = false } = {}) {
    const allBlogs = await dbManager.getBlogsDatabase().getAll();
    const publicBlogIds = new Set(allBlogs.filter((blog) => blog.visibility === "public" && blog.deletedAt == null).map((blog) => blog.id));

    const query = typeof search === "string" ? search.trim().toLowerCase() : "";
    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const normalizedSort = this._normalizeSort(sort);
    const posts = await this.postsDb.getAll();

    const results = posts.filter((post) => {
      if (post.deletedAt != null) return false;
      if (!publicBlogIds.has(post.blogId)) return false;
      if (!query) return true;

      const titleMatches = typeof post.title === "string" && post.title.toLowerCase().includes(query);
      const contentMatches = typeof post.content === "string" && post.content.toLowerCase().includes(query);

      return titleMatches || contentMatches;
    });

    if (normalizedSort === "most-liked" && includeEngagement === true) {
      const enrichedResults = await this._enrichPosts(results, currentUserId, { includeEngagement, period });
      const sortedResults = this._sortEnrichedPosts(enrichedResults, normalizedSort);
      return normalizedLimit === null
        ? sortedResults.slice(normalizedOffset)
        : sortedResults.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    }

    const sortedResults = this._sortRawPosts(results, normalizedSort);

    const paginatedResults =
      normalizedLimit === null
        ? sortedResults.slice(normalizedOffset)
        : sortedResults.slice(normalizedOffset, normalizedOffset + normalizedLimit);

    return this._enrichPosts(paginatedResults, currentUserId, { includeEngagement, period });
  }

  async getPostBySlug(blogSlug, postSlug, currentUserId, options = {}) {
    const blog = await blogService.getBlogBySlug(blogSlug, currentUserId);
    if (!blog) {
      return null;
    }

    const normalizedPostSlug = this._normalizeSlug(postSlug);
    const posts = await this.postsDb.getAll();
    const post = posts.find((item) => item.blogId === blog.id && item.slug === normalizedPostSlug);
    if (!post || post.deletedAt != null) {
      return null;
    }

    const [enrichedPost] = await this._enrichPosts([post], currentUserId, options);
    return enrichedPost || null;
  }

  async createPost(userId, blogSlug, data) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (String(blog.userId) !== String(userId)) {
      throw new Error("Not authorized to create posts for this blog");
    }

    const { isValid, errors, sanitized } = this._validatePostData(data);
    if (!isValid) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    const slugBase = sanitized.slug || this._normalizeSlug(sanitized.title);
    const slug = await this._ensureUniqueSlug(blog.id, slugBase);
    const now = new Date().toISOString();

    const createdPost = await this.postsDb.add({
      userId,
      blogId: blog.id,
      title: sanitized.title,
      slug,
      content: sanitized.content,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    });

    try {
      publishNotificationEvent(
        {
          type: EVENT_TYPES.FARMLOG_POST_CREATED,
          payload: {
            postId: createdPost.id,
            blogId: createdPost.blogId,
            authorId: Number(userId),
            title: createdPost.title,
            slug: createdPost.slug,
            createdAt: createdPost.createdAt,
          },
          correlationId: `farmlog-post-${createdPost.id}`,
          source: "post.service",
        },
        {
          action: "farmlog_post_created",
          meta: { userId: Number(userId), postId: createdPost.id, blogId: createdPost.blogId },
        },
      );
    } catch (e) {
      // best-effort
    }

    return createdPost;
  }

  async updatePost(userId, blogSlug, postSlug, data) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (String(blog.userId) !== String(userId)) {
      throw new Error("Not authorized to update posts for this blog");
    }

    const post = await this.getPostBySlug(blogSlug, postSlug, userId);
    if (!post) {
      throw new Error("Post not found");
    }

    const { isValid, errors, sanitized } = this._validatePostData(data, { allowPartial: true });
    if (!isValid) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    if (Object.keys(sanitized).length === 0) {
      throw new Error("No valid fields provided to update");
    }

    const updatedFields = {};
    if (sanitized.title !== undefined) {
      updatedFields.title = sanitized.title;
    }
    if (sanitized.content !== undefined) {
      updatedFields.content = sanitized.content;
    }

    let newSlug = post.slug;
    if (sanitized.slug !== undefined) {
      newSlug = await this._ensureUniqueSlug(blog.id, sanitized.slug, post.id);
    } else if (sanitized.title !== undefined) {
      newSlug = await this._ensureUniqueSlug(blog.id, this._normalizeSlug(sanitized.title), post.id);
    }

    if (newSlug !== post.slug) {
      updatedFields.slug = newSlug;
    }

    updatedFields.updatedAt = new Date().toISOString();

    await this.postsDb.updateRecords(
      (item) => item.id === post.id,
      (item) => ({
        ...item,
        ...updatedFields,
      }),
    );

    const updatedPost = await this.getPostBySlug(blogSlug, newSlug, userId);
    try {
      publishNotificationEvent(
        {
          type: EVENT_TYPES.FARMLOG_POST_UPDATED,
          payload: {
            postId: updatedPost.id,
            blogId: updatedPost.blogId,
            authorId: Number(userId),
            changes: updatedFields,
            updatedAt: updatedPost.updatedAt,
            title: updatedPost.title,
          },
          correlationId: `farmlog-post-update-${updatedPost.id}`,
          source: "post.service",
        },
        {
          action: "farmlog_post_updated",
          meta: { userId: Number(userId), postId: updatedPost.id, blogId: updatedPost.blogId },
        },
      );
    } catch (e) {
      // best-effort
    }

    return updatedPost;
  }

  async deletePost(userId, blogSlug, postSlug) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (String(blog.userId) !== String(userId)) {
      throw new Error("Not authorized to delete posts for this blog");
    }

    const post = await this.getPostBySlug(blogSlug, postSlug, userId);
    if (!post) {
      throw new Error("Post not found");
    }

    const deletedAt = new Date().toISOString();
    await this.postsDb.updateRecords(
      (item) => item.id === post.id,
      (item) => ({
        ...item,
        deletedAt,
        deletedBy: userId,
        updatedAt: deletedAt,
      }),
    );

    try {
      publishNotificationEvent(
        {
          type: EVENT_TYPES.FARMLOG_POST_DELETED,
          payload: {
            postId: post.id,
            blogId: post.blogId,
            authorId: Number(userId),
            deletedAt,
            title: post.title,
          },
          correlationId: `farmlog-post-deleted-${post.id}`,
          source: "post.service",
        },
        {
          action: "farmlog_post_deleted",
          meta: { userId: Number(userId), postId: post.id, blogId: post.blogId },
        },
      );
    } catch (e) {
      // best-effort
    }

    return { id: post.id, slug: post.slug, deletedAt };
  }
}

module.exports = new PostService();
