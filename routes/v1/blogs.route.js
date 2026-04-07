const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const blogController = require("../../controllers/blog.controller");
const postController = require("../../controllers/post.controller");

const blogRoute = express.Router();
const apiLimiter = createRateLimiter("api");

blogRoute.get("/blogs", apiLimiter, blogController.listBlogs.bind(blogController));
blogRoute.get("/blogs/search", apiLimiter, blogController.searchBlogs.bind(blogController));
blogRoute.get("/blogs/:blogSlug", apiLimiter, blogController.getBlog.bind(blogController));
blogRoute.post("/blogs", apiLimiter, authenticateUser, blogController.createBlog.bind(blogController));
blogRoute.patch("/blogs/:blogSlug", apiLimiter, authenticateUser, blogController.updateBlog.bind(blogController));
blogRoute.delete("/blogs/:blogSlug", apiLimiter, authenticateUser, blogController.deleteBlog.bind(blogController));

blogRoute.get("/blogs/:blogSlug/posts", apiLimiter, postController.listPosts.bind(postController));
blogRoute.get("/blogs/posts/search", apiLimiter, postController.searchPosts.bind(postController));
blogRoute.get("/blogs/:blogSlug/posts/:postSlug", apiLimiter, postController.getPost.bind(postController));
blogRoute.post("/blogs/:blogSlug/posts", apiLimiter, authenticateUser, postController.createPost.bind(postController));
blogRoute.patch("/blogs/:blogSlug/posts/:postSlug", apiLimiter, authenticateUser, postController.updatePost.bind(postController));
blogRoute.delete("/blogs/:blogSlug/posts/:postSlug", apiLimiter, authenticateUser, postController.deletePost.bind(postController));

module.exports = blogRoute;
