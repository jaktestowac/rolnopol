const dbManager = require("../data/database-manager");
const blogService = require("./blog.service");
const UserDataSingleton = require("../data/user-data-singleton");

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

  async listPosts(blogSlug, currentUserId, limit, offset) {
    const blog = await blogService.getBlogBySlug(blogSlug, currentUserId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const posts = await this.postsDb.getAll();
    const results = posts
      .filter((post) => post.blogId === blog.id && post.deletedAt == null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const paginatedResults =
      normalizedLimit === null ? results.slice(normalizedOffset) : results.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    const userDataInstance = UserDataSingleton.getInstance();

    return await Promise.all(
      paginatedResults.map(async (post) => {
        try {
          const user = await userDataInstance.findUser(post.userId);
          return {
            ...post,
            authorName: user?.displayedName || user?.email || "Anonymous",
          };
        } catch {
          return {
            ...post,
            authorName: "Anonymous",
          };
        }
      }),
    );
  }

  async searchPosts({ search, limit, offset } = {}) {
    const allBlogs = await dbManager.getBlogsDatabase().getAll();
    const publicBlogIds = new Set(allBlogs.filter((blog) => blog.visibility === "public" && blog.deletedAt == null).map((blog) => blog.id));

    const query = typeof search === "string" ? search.trim().toLowerCase() : "";
    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const posts = await this.postsDb.getAll();

    const results = posts
      .filter((post) => {
        if (post.deletedAt != null) return false;
        if (!publicBlogIds.has(post.blogId)) return false;
        if (!query) return true;

        const titleMatches = typeof post.title === "string" && post.title.toLowerCase().includes(query);
        const contentMatches = typeof post.content === "string" && post.content.toLowerCase().includes(query);

        return titleMatches || contentMatches;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const paginatedResults =
      normalizedLimit === null ? results.slice(normalizedOffset) : results.slice(normalizedOffset, normalizedOffset + normalizedLimit);

    // Enrich with author information
    const userDataInstance = UserDataSingleton.getInstance();
    const enrichedResults = await Promise.all(
      paginatedResults.map(async (post) => {
        try {
          const user = await userDataInstance.findUser(post.userId);
          return {
            ...post,
            authorName: user?.displayedName || user?.email || "Anonymous",
          };
        } catch {
          return {
            ...post,
            authorName: "Anonymous",
          };
        }
      }),
    );

    return enrichedResults;
  }

  async getPostBySlug(blogSlug, postSlug, currentUserId) {
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

    return post;
  }

  async createPost(userId, blogSlug, data) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (blog.userId !== userId) {
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

    return createdPost;
  }

  async updatePost(userId, blogSlug, postSlug, data) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (blog.userId !== userId) {
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

    return await this.getPostBySlug(blogSlug, newSlug, userId);
  }

  async deletePost(userId, blogSlug, postSlug) {
    const blog = await blogService.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (blog.userId !== userId) {
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

    return { id: post.id, slug: post.slug, deletedAt };
  }
}

module.exports = new PostService();
