import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const fs = require("fs");
const path = require("path");
const dbManager = require("../../data/database-manager");

const DATA_DIR = path.resolve(__dirname, "../../data");

function readJsonSnapshot(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"));
}

const initialBlogs = readJsonSnapshot("blogs.json");
const initialPosts = readJsonSnapshot("posts.json");
const initialLikes = readJsonSnapshot("farmlog-post-likes.json");
const initialFavorites = readJsonSnapshot("farmlog-favorites.json");
const initialUsers = readJsonSnapshot("users.json");
const initialFinancial = readJsonSnapshot("financial.json");
const initialFeatureFlags = readJsonSnapshot("feature-flags.json");

const app = require("../../api/index.js");

describe("Farmlog Post API", () => {
  async function patchFlags(flags) {
    await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
  }

  function makeTestUser() {
    const random = Math.random().toString(36).slice(2, 10);
    return {
      email: `farmlog_post_${Date.now()}_${random}@test.com`,
      displayedName: "Post Tester",
      password: "testpass123",
    };
  }

  async function createAuthToken(user) {
    await request(app).post("/api/v1/register").send(user).expect(201);
    const loginRes = await request(app).post("/api/v1/login").send({ email: user.email, password: user.password }).expect(200);
    return loginRes.body?.data?.token;
  }

  async function createBlog(token, title, visibility = "public") {
    const res = await request(app).post("/api/v1/blogs").set("Authorization", `Bearer ${token}`).send({ title, visibility }).expect(201);
    return res.body.data;
  }

  beforeEach(async () => {
    await dbManager.getBlogsDatabase().replaceAll([]);
    await dbManager.getPostsDatabase().replaceAll([]);
    await dbManager.getPostLikesDatabase().replaceAll([]);
    await dbManager.getFarmlogFavoritesDatabase().replaceAll([]);
    await patchFlags({ rolnopolFarmlogEnabled: true });
  });

  afterEach(async () => {
    await dbManager.getFeatureFlagsDatabase().replaceAll(initialFeatureFlags);
    await dbManager.getBlogsDatabase().replaceAll(initialBlogs);
    await dbManager.getPostsDatabase().replaceAll(initialPosts);
    await dbManager.getPostLikesDatabase().replaceAll(initialLikes);
    await dbManager.getFarmlogFavoritesDatabase().replaceAll(initialFavorites);
    await dbManager.getUsersDatabase().replaceAll(initialUsers);
    await dbManager.getFinancialDatabase().replaceAll(initialFinancial);
  });

  it("creates, lists, retrieves, updates, and soft deletes a post", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Post Blog", "public");

    const createRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "My First Post", content: "This is the first post." })
      .expect(201);

    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data).toHaveProperty("slug", "my-first-post");
    expect(createRes.body.data).toHaveProperty("content", "This is the first post.");
    expect(createRes.body.data).toHaveProperty("blogId", blog.id);

    const listRes = await request(app).get(`/api/v1/blogs/${blog.slug}/posts`).expect(200);
    expect(listRes.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "my-first-post" })]));

    const getRes = await request(app).get(`/api/v1/blogs/${blog.slug}/posts/my-first-post`).expect(200);
    expect(getRes.body.data).toHaveProperty("title", "My First Post");

    const updateRes = await request(app)
      .patch(`/api/v1/blogs/${blog.slug}/posts/my-first-post`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated Post Title" })
      .expect(200);

    expect(updateRes.body.data).toHaveProperty("title", "Updated Post Title");
    expect(updateRes.body.data).toHaveProperty("slug", "updated-post-title");

    const deleteRes = await request(app)
      .delete(`/api/v1/blogs/${blog.slug}/posts/updated-post-title`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteRes.body.data).toHaveProperty("deletedAt");

    await request(app).get(`/api/v1/blogs/${blog.slug}/posts/updated-post-title`).expect(404);
    const afterDeleteList = await request(app).get(`/api/v1/blogs/${blog.slug}/posts`).expect(200);
    expect(afterDeleteList.body.data).toEqual([]);
  });

  it("rejects invalid post payloads", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Invalid Post Blog", "public");

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "", content: "" })
      .expect(400);

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Ok", content: "a".repeat(5001) })
      .expect(400);
  });

  it("only allows the blog owner to manage posts", async () => {
    const owner = makeTestUser();
    const ownerToken = await createAuthToken(owner);
    const other = makeTestUser();
    const otherToken = await createAuthToken(other);

    const blog = await createBlog(ownerToken, "Owner Blog", "public");

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Other Post", content: "Not allowed" })
      .expect(403);

    const createRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Owner Post", content: "Allowed" })
      .expect(201);

    await request(app)
      .patch(`/api/v1/blogs/${blog.slug}/posts/${createRes.body.data.slug}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Hacked" })
      .expect(403);

    await request(app)
      .delete(`/api/v1/blogs/${blog.slug}/posts/${createRes.body.data.slug}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);
  });

  it("auto-resolves duplicate post slugs for the same blog", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Post Collision Blog", "public");

    const firstPost = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Duplicate Post", content: "First body." })
      .expect(201);

    const secondPost = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Duplicate Post", content: "Second body." })
      .expect(201);

    expect(firstPost.body.data.slug).toBe("duplicate-post");
    expect(secondPost.body.data.slug).toBe("duplicate-post-2");
  });

  it("hides posts for private blogs from non-owners", async () => {
    const owner = makeTestUser();
    const ownerToken = await createAuthToken(owner);
    const other = makeTestUser();
    const otherToken = await createAuthToken(other);

    const blog = await createBlog(ownerToken, "Private Post Blog", "private");

    const createRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Private Post", content: "Secret" })
      .expect(201);

    await request(app).get(`/api/v1/blogs/${blog.slug}/posts`).expect(404);
    await request(app).get(`/api/v1/blogs/${blog.slug}/posts/${createRes.body.data.slug}`).expect(404);

    const ownerList = await request(app).get(`/api/v1/blogs/${blog.slug}/posts`).set("Authorization", `Bearer ${ownerToken}`).expect(200);
    expect(ownerList.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ slug: createRes.body.data.slug })]));
  });

  it("supports post listing pagination", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Paginated Post Blog", "public");

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Post One", content: "One" })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Post Two", content: "Two" })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Post Three", content: "Three" })
      .expect(201);

    const paged = await request(app).get(`/api/v1/blogs/${blog.slug}/posts?limit=1&offset=1`).expect(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0].title).toBe("Post Two");
  });

  it("returns 404 for post routes when Farmlog feature is disabled", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Disabled Blog", "public");

    await patchFlags({ rolnopolFarmlogEnabled: false });

    await request(app).get(`/api/v1/blogs/${blog.slug}/posts`).expect(404);
    await request(app).get(`/api/v1/blogs/posts/search?q=test`).expect(404);
  });

  it("reuses the same post slug after soft delete", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);
    const blog = await createBlog(token, "Post Slug Reuse Blog", "public");

    const firstPost = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Reused Post", content: "First content." })
      .expect(201);

    await request(app)
      .delete(`/api/v1/blogs/${blog.slug}/posts/${firstPost.body.data.slug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const secondPost = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Reused Post", content: "Second content." })
      .expect(201);

    expect(secondPost.body.data.slug).toBe(firstPost.body.data.slug);
    expect(secondPost.body.data.title).toBe("Reused Post");
  });

  it("allows authenticated users to like, unlike, favorite, and unfavorite posts when engagement flag is enabled", async () => {
    await patchFlags({ rolnopolFarmlogEngagementEnabled: true });

    const owner = makeTestUser();
    const ownerToken = await createAuthToken(owner);
    const reader = makeTestUser();
    const readerToken = await createAuthToken(reader);
    const blog = await createBlog(ownerToken, "Engaged Post Blog", "public");

    const createRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Likable Post", content: "Please like me." })
      .expect(201);

    const postSlug = createRes.body.data.slug;

    const likeRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts/${postSlug}/like`)
      .set("Authorization", `Bearer ${readerToken}`)
      .expect(200);

    expect(likeRes.body.data).toMatchObject({
      slug: postSlug,
      likesCount: 1,
      likedByCurrentUser: true,
    });

    const favoriteRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts/${postSlug}/favorite`)
      .set("Authorization", `Bearer ${readerToken}`)
      .expect(200);

    expect(favoriteRes.body.data).toMatchObject({
      slug: postSlug,
      favoritedByCurrentUser: true,
    });

    const detailRes = await request(app)
      .get(`/api/v1/blogs/${blog.slug}/posts/${postSlug}`)
      .set("Authorization", `Bearer ${readerToken}`)
      .expect(200);

    expect(detailRes.body.data).toMatchObject({
      likesCount: 1,
      likedByCurrentUser: true,
      favoritedByCurrentUser: true,
    });

    const unlikeRes = await request(app)
      .delete(`/api/v1/blogs/${blog.slug}/posts/${postSlug}/like`)
      .set("Authorization", `Bearer ${readerToken}`)
      .expect(200);

    expect(unlikeRes.body.data).toMatchObject({
      likesCount: 0,
      likedByCurrentUser: false,
    });

    const unfavoriteRes = await request(app)
      .delete(`/api/v1/blogs/${blog.slug}/posts/${postSlug}/favorite`)
      .set("Authorization", `Bearer ${readerToken}`)
      .expect(200);

    expect(unfavoriteRes.body.data).toHaveProperty("favoritedByCurrentUser", false);
  });

  it("returns 404 for engagement post routes when engagement flag is disabled", async () => {
    const owner = makeTestUser();
    const ownerToken = await createAuthToken(owner);
    const blog = await createBlog(ownerToken, "Disabled Engagement Blog", "public");

    const createRes = await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Normal Post", content: "Still just a post." })
      .expect(201);

    await request(app)
      .post(`/api/v1/blogs/${blog.slug}/posts/${createRes.body.data.slug}/like`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(404);
  });
});
