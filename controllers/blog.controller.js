const { formatResponseBody, sendError } = require("../helpers/response-helper");
const { isUserLogged, getUserId } = require("../helpers/token.helpers");
const featureFlagsService = require("../services/feature-flags.service");
const blogService = require("../services/blog.service");
const { logError } = require("../helpers/logger-api");

class BlogController {
  async _isFeatureEnabled() {
    const data = await featureFlagsService.getFeatureFlags();
    return data?.flags?.rolnopolFarmlogEnabled === true;
  }

  _extractUserId(req) {
    let token = req.headers.token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token && req.cookies && req.cookies.rolnopolToken) {
      token = req.cookies.rolnopolToken;
    }

    if (!token || !isUserLogged(token)) {
      return null;
    }

    return getUserId(token);
  }

  async listBlogs(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const currentUserId = this._extractUserId(req);
      const search = req.query.search || req.query.q;
      const limit = req.query.limit;
      const offset = req.query.offset;
      const blogs = await blogService.listBlogs({ search, currentUserId, limit, offset });

      return res.status(200).json(formatResponseBody({ data: blogs }));
    } catch (error) {
      logError("Error listing blogs:", error);
      return sendError(req, res, 500, "Failed to list blogs");
    }
  }

  async getBlog(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const currentUserId = this._extractUserId(req);
      const blog = await blogService.getBlogBySlug(req.params.blogSlug, currentUserId);

      if (!blog) {
        return sendError(req, res, 404, "Blog not found");
      }

      return res.status(200).json(formatResponseBody({ data: blog }));
    } catch (error) {
      logError("Error retrieving blog:", error);
      return sendError(req, res, 500, "Failed to retrieve blog");
    }
  }

  async searchBlogs(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const search = req.query.search || req.query.q;
      const limit = req.query.limit;
      const offset = req.query.offset;
      const blogs = await blogService.searchBlogs({ search, limit, offset });
      return res.status(200).json(formatResponseBody({ data: blogs }));
    } catch (error) {
      logError("Error searching blogs:", error);
      return sendError(req, res, 500, "Failed to search blogs");
    }
  }

  async createBlog(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const blog = await blogService.createBlog(req.user.userId, req.body || {});
      return res.status(201).json(formatResponseBody({ data: blog }));
    } catch (error) {
      logError("Error creating blog:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to create blog";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("validation failed")) {
        return sendError(req, res, 400, message);
      }
      if (lowerMessage.includes("only create one")) {
        return sendError(req, res, 409, message);
      }
      return sendError(req, res, 500, message);
    }
  }

  async updateBlog(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const blog = await blogService.updateBlog(req.user.userId, req.params.blogSlug, req.body || {});
      return res.status(200).json(formatResponseBody({ data: blog }));
    } catch (error) {
      logError("Error updating blog:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to update blog";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("validation failed") || lowerMessage.includes("no valid fields provided")) {
        return sendError(req, res, 400, message);
      }
      if (lowerMessage.includes("not authorized")) {
        return sendError(req, res, 403, message);
      }
      if (lowerMessage.includes("blog not found")) {
        return sendError(req, res, 404, message);
      }
      return sendError(req, res, 500, message);
    }
  }

  async deleteBlog(req, res) {
    try {
      if (!(await this._isFeatureEnabled())) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const result = await blogService.deleteBlog(req.user.userId, req.params.blogSlug);
      return res.status(200).json(formatResponseBody({ message: "Blog deleted successfully", data: result }));
    } catch (error) {
      logError("Error deleting blog:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to delete blog";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("not authorized")) {
        return sendError(req, res, 403, message);
      }
      if (lowerMessage.includes("blog not found")) {
        return sendError(req, res, 404, message);
      }
      return sendError(req, res, 500, message);
    }
  }
}

module.exports = new BlogController();
