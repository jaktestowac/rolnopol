const { formatResponseBody, sendError } = require("../helpers/response-helper");
const { isUserLogged, getUserId } = require("../helpers/token.helpers");
const featureFlagsService = require("../services/feature-flags.service");
const postService = require("../services/post.service");
const farmlogEngagementService = require("../services/farmlog-engagement.service");
const { logError } = require("../helpers/logger-api");

class PostController {
  async _getFeatureState() {
    const data = await featureFlagsService.getFeatureFlags();
    return {
      farmlogEnabled: data?.flags?.rolnopolFarmlogEnabled === true,
      engagementEnabled: data?.flags?.rolnopolFarmlogEngagementEnabled === true,
    };
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

  async listPosts(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const currentUserId = this._extractUserId(req);
      const limit = req.query.limit;
      const offset = req.query.offset;
      const sort = req.query.sort;
      const period = req.query.period;
      const posts = await postService.listPosts(req.params.blogSlug, currentUserId, limit, offset, {
        sort,
        period,
        includeEngagement: featureState.engagementEnabled,
      });
      return res.status(200).json(formatResponseBody({ data: posts }));
    } catch (error) {
      logError("Error listing posts:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to list posts";
      if (message.toLowerCase().includes("blog not found")) {
        return sendError(req, res, 404, message);
      }
      return sendError(req, res, 500, message);
    }
  }

  async searchPosts(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const currentUserId = this._extractUserId(req);
      const search = req.query.search || req.query.q;
      const limit = req.query.limit;
      const offset = req.query.offset;
      const sort = req.query.sort;
      const period = req.query.period;
      const posts = await postService.searchPosts({
        search,
        currentUserId,
        limit,
        offset,
        sort,
        period,
        includeEngagement: featureState.engagementEnabled,
      });
      return res.status(200).json(formatResponseBody({ data: posts }));
    } catch (error) {
      logError("Error searching posts:", error);
      return sendError(req, res, 500, "Failed to search posts");
    }
  }

  async getPost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const currentUserId = this._extractUserId(req);
      const post = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, currentUserId, {
        includeEngagement: featureState.engagementEnabled,
      });

      if (!post) {
        return sendError(req, res, 404, "Post not found");
      }

      return res.status(200).json(formatResponseBody({ data: post }));
    } catch (error) {
      logError("Error retrieving post:", error);
      return sendError(req, res, 500, "Failed to retrieve post");
    }
  }

  async likePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled || !featureState.engagementEnabled) {
        return sendError(req, res, 404, "Farmlog engagement feature not available");
      }

      const post = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId);
      if (!post) {
        return sendError(req, res, 404, "Post not found");
      }

      await farmlogEngagementService.likePost(req.user.userId, post);
      const updatedPost = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId, {
        includeEngagement: true,
      });

      return res.status(200).json(formatResponseBody({ data: updatedPost }));
    } catch (error) {
      logError("Error liking post:", error);
      return sendError(req, res, 500, "Failed to like post");
    }
  }

  async unlikePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled || !featureState.engagementEnabled) {
        return sendError(req, res, 404, "Farmlog engagement feature not available");
      }

      const post = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId);
      if (!post) {
        return sendError(req, res, 404, "Post not found");
      }

      await farmlogEngagementService.unlikePost(req.user.userId, post);
      const updatedPost = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId, {
        includeEngagement: true,
      });

      return res.status(200).json(formatResponseBody({ data: updatedPost }));
    } catch (error) {
      logError("Error unliking post:", error);
      return sendError(req, res, 500, "Failed to update post like");
    }
  }

  async favoritePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled || !featureState.engagementEnabled) {
        return sendError(req, res, 404, "Farmlog engagement feature not available");
      }

      const post = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId);
      if (!post) {
        return sendError(req, res, 404, "Post not found");
      }

      await farmlogEngagementService.favoritePost(req.user.userId, post);
      const updatedPost = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId, {
        includeEngagement: true,
      });

      return res.status(200).json(formatResponseBody({ data: updatedPost }));
    } catch (error) {
      logError("Error favoriting post:", error);
      return sendError(req, res, 500, "Failed to favorite post");
    }
  }

  async unfavoritePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled || !featureState.engagementEnabled) {
        return sendError(req, res, 404, "Farmlog engagement feature not available");
      }

      const post = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId);
      if (!post) {
        return sendError(req, res, 404, "Post not found");
      }

      await farmlogEngagementService.unfavoritePost(req.user.userId, post);
      const updatedPost = await postService.getPostBySlug(req.params.blogSlug, req.params.postSlug, req.user.userId, {
        includeEngagement: true,
      });

      return res.status(200).json(formatResponseBody({ data: updatedPost }));
    } catch (error) {
      logError("Error unfavoriting post:", error);
      return sendError(req, res, 500, "Failed to update post favorite");
    }
  }

  async createPost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const post = await postService.createPost(req.user.userId, req.params.blogSlug, req.body || {});
      return res.status(201).json(formatResponseBody({ data: post }));
    } catch (error) {
      logError("Error creating post:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to create post";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("validation failed")) {
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

  async updatePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const post = await postService.updatePost(req.user.userId, req.params.blogSlug, req.params.postSlug, req.body || {});
      return res.status(200).json(formatResponseBody({ data: post }));
    } catch (error) {
      logError("Error updating post:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to update post";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("validation failed") || lowerMessage.includes("no valid fields provided")) {
        return sendError(req, res, 400, message);
      }
      if (lowerMessage.includes("not authorized")) {
        return sendError(req, res, 403, message);
      }
      if (lowerMessage.includes("post not found")) {
        return sendError(req, res, 404, message);
      }
      if (lowerMessage.includes("blog not found")) {
        return sendError(req, res, 404, message);
      }
      return sendError(req, res, 500, message);
    }
  }

  async deletePost(req, res) {
    try {
      const featureState = await this._getFeatureState();
      if (!featureState.farmlogEnabled) {
        return sendError(req, res, 404, "Farmlog feature not available");
      }

      const result = await postService.deletePost(req.user.userId, req.params.blogSlug, req.params.postSlug);
      return res.status(200).json(formatResponseBody({ message: "Post deleted successfully", data: result }));
    } catch (error) {
      logError("Error deleting post:", error);
      const message = typeof error.message === "string" ? error.message : "Failed to delete post";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("not authorized")) {
        return sendError(req, res, 403, message);
      }
      if (lowerMessage.includes("post not found") || lowerMessage.includes("blog not found")) {
        return sendError(req, res, 404, message);
      }
      return sendError(req, res, 500, message);
    }
  }
}

module.exports = new PostController();
