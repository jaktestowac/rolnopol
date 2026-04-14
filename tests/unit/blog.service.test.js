import { describe, it, expect, beforeEach } from "vitest";

const dbManager = require("../../data/database-manager");
const blogService = require("../../services/blog.service");
const postService = require("../../services/post.service");

describe("blog.service", () => {
  beforeEach(async () => {
    await dbManager.getBlogsDatabase().replaceAll([]);
    await dbManager.getPostsDatabase().replaceAll([]);
    await dbManager.getUsersDatabase().replaceAll([]);
  });

  it("creates a public blog with generated slug and default values", async () => {
    const blog = await blogService.createBlog(100, { title: "My Sample Blog" });

    expect(blog).toMatchObject({
      userId: 100,
      title: "My Sample Blog",
      slug: "my-sample-blog",
      visibility: "public",
      tags: [],
      deletedAt: null,
    });
  });

  it("prevents a user from creating more than one active blog", async () => {
    await blogService.createBlog(101, { title: "First Blog" });

    await expect(blogService.createBlog(101, { title: "Second Blog" })).rejects.toThrow("Each user may only create one active blog");
  });

  it("updates a blog slug and auto-resolves collisions", async () => {
    const blogA = await blogService.createBlog(102, { title: "Blog A" });
    const blogB = await blogService.createBlog(103, { title: "Blog B" });

    const updated = await blogService.updateBlog(102, blogA.slug, { slug: blogB.slug });

    expect(updated.slug).toBe(`${blogB.slug}-2`);
    expect(updated.title).toBe(blogA.title);
  });

  it("returns private blogs only to their owner and hides them from others", async () => {
    const privateBlog = await blogService.createBlog(104, { title: "Private Blog", visibility: "private" });

    const ownerView = await blogService.getBlogBySlug(privateBlog.slug, 104);
    expect(ownerView).toEqual(expect.objectContaining({ slug: privateBlog.slug, visibility: "private" }));

    const anonymousView = await blogService.getBlogBySlug(privateBlog.slug, null);
    expect(anonymousView).toBeNull();

    const otherUserView = await blogService.getBlogBySlug(privateBlog.slug, 999);
    expect(otherUserView).toBeNull();
  });

  it("enriches blog details with the blog author name", async () => {
    const userDb = dbManager.getUsersDatabase();
    const user = await userDb.add({ email: "author@example.com", displayedName: "Farm Author", password: "password", isActive: true });

    const blog = await blogService.createBlog(user.id, { title: "Attribution Blog" });
    const result = await blogService.getBlogBySlug(blog.slug, null);

    expect(result).toMatchObject({ slug: blog.slug, authorName: "Farm Author" });
  });

  it("searches public blogs by post content and excludes private blogs", async () => {
    const publicBlog = await blogService.createBlog(105, { title: "Public Blog", visibility: "public" });
    const privateBlog = await blogService.createBlog(106, { title: "Private Blog", visibility: "private" });

    await postService.createPost(105, publicBlog.slug, { title: "Public Post", content: "searchable content" });
    await postService.createPost(106, privateBlog.slug, { title: "Private Post", content: "searchable content" });

    const results = await blogService.searchBlogs({ search: "searchable" });

    expect(results.map((item) => item.slug)).toEqual([publicBlog.slug]);
  });

  it("lists private blogs for their owner only", async () => {
    await blogService.createBlog(107, { title: "Owner Private", visibility: "private" });
    await blogService.createBlog(108, { title: "Public Listing", visibility: "public" });

    const ownerList = await blogService.listBlogs({ currentUserId: 107 });
    expect(ownerList.some((blog) => blog.visibility === "private")).toBe(true);

    const anonymousList = await blogService.listBlogs({ currentUserId: null });
    expect(anonymousList.some((blog) => blog.visibility === "private")).toBe(false);
  });

  it("throws an error when creating a blog with invalid input", async () => {
    await expect(blogService.createBlog(105, { title: "" })).rejects.toThrow("Validation failed: Blog title is required");
  });

  it("handles slug collision with multiple retries", async () => {
    await blogService.createBlog(106, { title: "Duplicate Blog" });
    await blogService.createBlog(107, { title: "Duplicate Blog" });

    const blog = await blogService.createBlog(108, { title: "Duplicate Blog" });
    expect(blog.slug).toBe("duplicate-blog-3");
  });
});
