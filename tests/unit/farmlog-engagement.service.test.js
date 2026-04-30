import { describe, it, expect, beforeEach } from "vitest";

const dbManager = require("../../data/database-manager");
const blogService = require("../../services/blog.service");
const postService = require("../../services/post.service");
const farmlogEngagementService = require("../../services/farmlog-engagement.service");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("farmlog-engagement.service", () => {
  beforeEach(async () => {
    await Promise.all([
      dbManager.getBlogsDatabase().replaceAll([]),
      dbManager.getPostsDatabase().replaceAll([]),
      dbManager.getUsersDatabase().replaceAll([]),
      dbManager.getPostLikesDatabase().replaceAll([]),
      dbManager.getFarmlogFavoritesDatabase().replaceAll([]),
    ]);
  });

  it("enriches posts with like and favorite state, including period counts", async () => {
    const blog = await blogService.createBlog(900, { title: "Engagement Blog", visibility: "public" });
    const post = await postService.createPost(900, blog.slug, { title: "Popular Post", content: "Fresh update" });
    const now = new Date().toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const fortyDaysAgo = new Date(Date.now() - 40 * DAY_MS).toISOString();

    await dbManager.getPostLikesDatabase().replaceAll([
      { id: 1, userId: 1, postId: post.id, blogId: blog.id, createdAt: now, updatedAt: now },
      { id: 2, userId: 2, postId: post.id, blogId: blog.id, createdAt: twoDaysAgo, updatedAt: twoDaysAgo },
      { id: 3, userId: 3, postId: post.id, blogId: blog.id, createdAt: fortyDaysAgo, updatedAt: fortyDaysAgo },
    ]);

    await farmlogEngagementService.favoriteBlog(42, blog);
    await farmlogEngagementService.favoritePost(42, post);

    const [enrichedPost] = await farmlogEngagementService.enrichPosts([post], 42, { period: "7d" });
    const [enrichedBlog] = await farmlogEngagementService.enrichBlogs([blog], 42);

    expect(enrichedPost).toMatchObject({
      likesCount: 3,
      periodLikesCount: 2,
      likedByCurrentUser: false,
      favoritedByCurrentUser: true,
      blogSlug: blog.slug,
      blogTitle: blog.title,
    });
    expect(enrichedBlog).toMatchObject({
      favoritedByCurrentUser: true,
    });
  });

  it("adds and removes post likes idempotently", async () => {
    const blog = await blogService.createBlog(901, { title: "Likes Blog", visibility: "public" });
    const post = await postService.createPost(901, blog.slug, { title: "One Post", content: "Hello" });

    await farmlogEngagementService.likePost(123, post);
    await farmlogEngagementService.likePost(123, post);

    const likesAfterLike = await dbManager.getPostLikesDatabase().getAll();
    expect(likesAfterLike).toHaveLength(1);

    await farmlogEngagementService.unlikePost(123, post);

    const likesAfterUnlike = await dbManager.getPostLikesDatabase().getAll();
    expect(likesAfterUnlike).toHaveLength(0);
  });
});
