import { describe, it, expect, beforeEach } from "vitest";

const dbManager = require("../../data/database-manager");
const blogService = require("../../services/blog.service");
const postService = require("../../services/post.service");

describe("post.service", () => {
  beforeEach(async () => {
    await dbManager.getBlogsDatabase().replaceAll([]);
    await dbManager.getPostsDatabase().replaceAll([]);
    await dbManager.getUsersDatabase().replaceAll([]);
  });

  it("creates posts and auto-resolves slug collisions within the same blog", async () => {
    const blog = await blogService.createBlog(200, { title: "Post Collision Blog" });

    const first = await postService.createPost(200, blog.slug, { title: "Duplicate Post", content: "First content" });
    const second = await postService.createPost(200, blog.slug, { title: "Duplicate Post", content: "Second content" });

    expect(first.slug).toBe("duplicate-post");
    expect(second.slug).toBe("duplicate-post-2");
  });

  it("rejects creating a post for a blog owned by another user", async () => {
    const blog = await blogService.createBlog(201, { title: "Owner Blog" });

    await expect(postService.createPost(202, blog.slug, { title: "Not Allowed", content: "Nope" })).rejects.toThrow(
      "Not authorized to create posts for this blog",
    );
  });

  it("updates a post slug and ensures explicit slug collisions are resolved", async () => {
    const blog = await blogService.createBlog(203, { title: "Update Slug Blog" });
    const firstPost = await postService.createPost(203, blog.slug, { title: "First Post", content: "Content" });
    await postService.createPost(203, blog.slug, { title: "Second Post", content: "Content" });

    const updated = await postService.updatePost(203, blog.slug, firstPost.slug, { slug: "second-post" });
    expect(updated.slug).toBe("second-post-2");
  });

  it("soft deletes posts and prevents deleted posts from being listed or retrieved", async () => {
    const blog = await blogService.createBlog(204, { title: "Delete Post Blog" });
    const post = await postService.createPost(204, blog.slug, { title: "Trash Post", content: "Discard me" });

    await postService.deletePost(204, blog.slug, post.slug);

    const afterDelete = await postService.getPostBySlug(blog.slug, post.slug, 204);
    expect(afterDelete).toBeNull();

    const listAfterDelete = await postService.listPosts(blog.slug, 204);
    expect(listAfterDelete).toHaveLength(0);
  });

  it("searches public posts only and excludes private blog posts", async () => {
    const publicBlog = await blogService.createBlog(205, { title: "Public Post Blog", visibility: "public" });
    const privateBlog = await blogService.createBlog(206, { title: "Private Post Blog", visibility: "private" });

    await postService.createPost(205, publicBlog.slug, { title: "Public Search Post", content: "Find me" });
    await postService.createPost(206, privateBlog.slug, { title: "Private Search Post", content: "Find me" });

    const results = await postService.searchPosts({ search: "find me" });
    expect(results.every((post) => post.blogId === publicBlog.id)).toBe(true);
    expect(results.some((post) => post.title === "Private Search Post")).toBe(false);
  });

  it("includes author name when listing blog posts", async () => {
    const userDb = dbManager.getUsersDatabase();
    const user = await userDb.add({ email: "postauthor@example.com", displayedName: "Post Author", password: "password", isActive: true });

    const blog = await blogService.createBlog(user.id, { title: "Author Post Blog" });
    await postService.createPost(user.id, blog.slug, { title: "First Post", content: "Hello world" });

    const posts = await postService.listPosts(blog.slug, user.id);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ authorName: "Post Author" });
  });
});
