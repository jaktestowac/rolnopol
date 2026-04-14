const dbManager = require("../data/database-manager");
const UserDataSingleton = require("../data/user-data-singleton");

class BlogService {
  constructor() {
    this.blogsDb = dbManager.getBlogsDatabase();
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

  async _ensureUniqueSlug(slug, excludeId = null) {
    const blogs = await this.blogsDb.getAll();
    let candidate = slug;
    let suffix = 1;

    while (blogs.some((blog) => blog.slug === candidate && blog.id !== excludeId && blog.deletedAt == null)) {
      suffix += 1;
      candidate = `${slug}-${suffix}`;
    }

    return candidate;
  }

  _validateBlogData(data, options = {}) {
    const errors = [];
    const allowPartial = options.allowPartial === true;
    const sanitized = {};

    if (!this._isPlainObject(data)) {
      errors.push("Blog data must be an object");
      return { isValid: false, errors, sanitized };
    }

    if (!allowPartial || data.title !== undefined) {
      if (typeof data.title !== "string" || data.title.trim().length === 0) {
        errors.push("Blog title is required");
      } else {
        const trimmedTitle = data.title.trim();
        if (trimmedTitle.length < 3 || trimmedTitle.length > 255) {
          errors.push("Blog title must be between 3 and 255 characters");
        } else {
          sanitized.title = trimmedTitle;
        }
      }
    }

    if (data.visibility !== undefined) {
      if (typeof data.visibility !== "string" || !["public", "private"].includes(data.visibility)) {
        errors.push("Visibility must be either public or private");
      } else {
        sanitized.visibility = data.visibility;
      }
    }

    if (data.slug !== undefined) {
      if (typeof data.slug !== "string" || this._normalizeSlug(data.slug).length === 0) {
        errors.push("Slug must be a valid non-empty string");
      } else {
        sanitized.slug = this._normalizeSlug(data.slug);
      }
    }

    if (data.tags !== undefined) {
      if (!Array.isArray(data.tags)) {
        errors.push("Tags must be an array of strings");
      } else if (data.tags.length > 5) {
        errors.push("A maximum of 5 tags is allowed");
      } else {
        const normalizedTags = [];
        for (const tag of data.tags) {
          if (typeof tag !== "string" || tag.trim().length === 0) {
            errors.push("Each tag must be a non-empty string");
            break;
          }
          const normalized = tag.trim();
          if (normalized.length > 25) {
            errors.push("Each tag must be 25 characters or fewer");
            break;
          }
          normalizedTags.push(normalized);
        }
        if (errors.length === 0) {
          sanitized.tags = normalizedTags;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  async listBlogs({ search, currentUserId, limit, offset } = {}) {
    const blogs = await this.blogsDb.getAll();
    const query = typeof search === "string" ? search.trim().toLowerCase() : "";
    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

    const results = blogs
      .filter((blog) => {
        if (blog.deletedAt != null) return false;
        const isVisible = blog.visibility === "public" || blog.userId === currentUserId;
        if (!isVisible) return false;

        if (!query) return true;

        const titleMatches = typeof blog.title === "string" && blog.title.toLowerCase().includes(query);
        const slugMatches = typeof blog.slug === "string" && blog.slug.toLowerCase().includes(query);
        const tagMatches = Array.isArray(blog.tags) ? blog.tags.some((tag) => tag.toLowerCase().includes(query)) : false;

        return titleMatches || slugMatches || tagMatches;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return normalizedLimit === null ? results.slice(normalizedOffset) : results.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  }

  async searchBlogs({ search, limit, offset } = {}) {
    const blogs = await this.blogsDb.getAll();
    const posts = await this.postsDb.getAll();
    const query = typeof search === "string" ? search.trim().toLowerCase() : "";
    const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

    const publicBlogPostMatches = new Set();
    if (query) {
      for (const post of posts) {
        if (post.deletedAt != null) continue;
        if (typeof post.title === "string" && post.title.toLowerCase().includes(query)) {
          publicBlogPostMatches.add(post.blogId);
        }
        if (typeof post.content === "string" && post.content.toLowerCase().includes(query)) {
          publicBlogPostMatches.add(post.blogId);
        }
      }
    }

    const results = blogs
      .filter((blog) => {
        if (blog.deletedAt != null) return false;
        if (blog.visibility !== "public") return false;
        if (!query) return true;

        const titleMatches = typeof blog.title === "string" && blog.title.toLowerCase().includes(query);
        const slugMatches = typeof blog.slug === "string" && blog.slug.toLowerCase().includes(query);
        const tagMatches = Array.isArray(blog.tags) ? blog.tags.some((tag) => tag.toLowerCase().includes(query)) : false;
        const postContentMatches = publicBlogPostMatches.has(blog.id);

        return titleMatches || slugMatches || tagMatches || postContentMatches;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const paginatedResults =
      normalizedLimit === null ? results.slice(normalizedOffset) : results.slice(normalizedOffset, normalizedOffset + normalizedLimit);

    // Enrich with author information
    const userDataInstance = UserDataSingleton.getInstance();
    const enrichedResults = await Promise.all(
      paginatedResults.map(async (blog) => {
        try {
          const user = await userDataInstance.findUser(blog.userId);
          return {
            ...blog,
            authorName: user?.displayedName || user?.email || "Anonymous",
          };
        } catch {
          return {
            ...blog,
            authorName: "Anonymous",
          };
        }
      }),
    );

    return enrichedResults;
  }

  async getBlogBySlug(slug, currentUserId = null) {
    const normalizedSlug = this._normalizeSlug(slug);
    const blogs = await this.blogsDb.getAll();
    const blog = blogs.find((item) => item.slug === normalizedSlug);
    if (!blog) return null;
    if (blog.deletedAt != null) return null;
    if (blog.visibility === "private" && blog.userId !== currentUserId) {
      return null;
    }

    try {
      const user = await UserDataSingleton.getInstance().findUser(blog.userId);
      return {
        ...blog,
        authorName: user?.displayedName || user?.email || "Anonymous",
      };
    } catch {
      return {
        ...blog,
        authorName: "Anonymous",
      };
    }
  }

  async createBlog(userId, data) {
    const { isValid, errors, sanitized } = this._validateBlogData(data);
    if (!isValid) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    const existingBlogs = await this.blogsDb.getAll();
    if (existingBlogs.some((blog) => blog.userId === userId && blog.deletedAt == null)) {
      throw new Error("Each user may only create one active blog");
    }

    const slugBase = sanitized.slug || this._normalizeSlug(sanitized.title);
    const slug = await this._ensureUniqueSlug(slugBase);
    const now = new Date().toISOString();

    const createdBlog = await this.blogsDb.add({
      userId,
      title: sanitized.title,
      slug,
      visibility: sanitized.visibility || "public",
      tags: sanitized.tags || [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    });

    return createdBlog;
  }

  async updateBlog(userId, blogSlug, data) {
    const blog = await this.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (blog.userId !== userId) {
      throw new Error("Not authorized to update this blog");
    }

    const { isValid, errors, sanitized } = this._validateBlogData(data, { allowPartial: true });
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

    if (sanitized.visibility !== undefined) {
      updatedFields.visibility = sanitized.visibility;
    }

    if (sanitized.tags !== undefined) {
      updatedFields.tags = sanitized.tags;
    }

    let newSlug = blog.slug;
    if (sanitized.slug !== undefined) {
      newSlug = await this._ensureUniqueSlug(sanitized.slug, blog.id);
    } else if (sanitized.title !== undefined) {
      const generatedSlug = await this._ensureUniqueSlug(this._normalizeSlug(sanitized.title), blog.id);
      newSlug = generatedSlug;
    }

    if (newSlug !== blog.slug) {
      updatedFields.slug = newSlug;
    }

    updatedFields.updatedAt = new Date().toISOString();

    await this.blogsDb.updateRecords(
      (item) => item.id === blog.id,
      (item) => ({
        ...item,
        ...updatedFields,
      }),
    );

    return await this.getBlogBySlug(newSlug, userId);
  }

  async deleteBlog(userId, blogSlug) {
    const blog = await this.getBlogBySlug(blogSlug, userId);
    if (!blog) {
      throw new Error("Blog not found");
    }

    if (blog.userId !== userId) {
      throw new Error("Not authorized to delete this blog");
    }

    const deletedAt = new Date().toISOString();
    await this.blogsDb.updateRecords(
      (item) => item.id === blog.id,
      (item) => ({
        ...item,
        deletedAt,
        deletedBy: userId,
        updatedAt: deletedAt,
      }),
    );

    return { id: blog.id, slug: blog.slug, deletedAt };
  }
}

module.exports = new BlogService();
