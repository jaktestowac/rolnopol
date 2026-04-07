import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const app = require("../../api/index.js");
const dbManager = require("../../data/database-manager");

describe("Farmlog Search API", () => {
  let originalFlags;

  async function getCurrentFlags() {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    return res.body?.data?.flags || {};
  }

  async function patchFlags(flags) {
    await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
  }

  async function replaceFlags(flags) {
    await request(app).put("/api/v1/feature-flags").send({ flags }).expect(200);
  }

  function makeTestUser() {
    const random = Math.random().toString(36).slice(2, 10);
    return {
      email: `farmlog_search_${Date.now()}_${random}@test.com`,
      displayedName: "Search Tester",
      password: "testpass123",
    };
  }

  async function createAuthToken(user) {
    await request(app).post("/api/v1/register").send(user).expect(201);
    const loginRes = await request(app).post("/api/v1/login").send({ email: user.email, password: user.password }).expect(200);
    return loginRes.body?.data?.token;
  }

  beforeEach(async () => {
    originalFlags = await getCurrentFlags();
    await dbManager.getBlogsDatabase().replaceAll([]);
    await dbManager.getPostsDatabase().replaceAll([]);
    await patchFlags({ rolnopolFarmlogEnabled: true });
  });

  afterEach(async () => {
    await replaceFlags(originalFlags);
    await dbManager.getBlogsDatabase().replaceAll([]);
    await dbManager.getPostsDatabase().replaceAll([]);
  });

  it("searches public blogs by title and tag only", async () => {
    const owner = makeTestUser();
    const token = await createAuthToken(owner);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Searchable Farmlog", visibility: "public", tags: ["farm", "field"] })
      .expect(201);

    const hiddenOwner = makeTestUser();
    const hiddenToken = await createAuthToken(hiddenOwner);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${hiddenToken}`)
      .send({ title: "Hidden Farmlog", visibility: "private", tags: ["farm"] })
      .expect(201);

    const titleSearch = await request(app).get("/api/v1/blogs/search?q=searchable").expect(200);
    expect(titleSearch.body.data).toHaveLength(1);
    expect(titleSearch.body.data[0].title).toBe("Searchable Farmlog");

    const tagSearch = await request(app).get("/api/v1/blogs/search?q=field").expect(200);
    expect(tagSearch.body.data).toHaveLength(1);
    expect(tagSearch.body.data[0].title).toBe("Searchable Farmlog");

    const missingSearch = await request(app).get("/api/v1/blogs/search?q=hidden").expect(200);
    expect(missingSearch.body.data).toHaveLength(0);
  });

  it("searches public blogs by post content", async () => {
    const owner = makeTestUser();
    const token = await createAuthToken(owner);
    const blogRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Blog With Posts", visibility: "public" })
      .expect(201);

    const blogSlug = blogRes.body.data.slug;

    await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "First Article", content: "This post mentions sea turtles and good farming." })
      .expect(201);

    const contentSearch = await request(app).get("/api/v1/blogs/search?q=sea turtles").expect(200);
    expect(contentSearch.body.data).toHaveLength(1);
    expect(contentSearch.body.data[0].slug).toBe(blogSlug);
  });

  it("searches public blogs with query, pagination, and sorting", async () => {
    const owner1 = makeTestUser();
    const token1 = await createAuthToken(owner1);
    const owner2 = makeTestUser();
    const token2 = await createAuthToken(owner2);
    const owner3 = makeTestUser();
    const token3 = await createAuthToken(owner3);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token1}`)
      .send({ title: "First Blog", visibility: "public", tags: ["search"] })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token2}`)
      .send({ title: "Second Blog", visibility: "public", tags: ["search"] })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token3}`)
      .send({ title: "Third Blog", visibility: "public", tags: ["search"] })
      .expect(201);

    const paged = await request(app).get("/api/v1/blogs/search?q=blog&limit=1&offset=1").expect(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0].title).toBe("Second Blog");
  });

  it("searches public posts by title and content and supports pagination", async () => {
    const owner = makeTestUser();
    const token = await createAuthToken(owner);
    const blogRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Blog For Posts", visibility: "public" })
      .expect(201);

    const blogSlug = blogRes.body.data.slug;

    await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "First Search Post", content: "This content mentions keyword alpha." })
      .expect(201);

    await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Second Search Post", content: "Another content block with alpha and beta." })
      .expect(201);

    const searchTitle = await request(app).get("/api/v1/blogs/posts/search?q=first").expect(200);
    expect(searchTitle.body.data).toHaveLength(1);
    expect(searchTitle.body.data[0].title).toBe("First Search Post");

    const searchContent = await request(app).get("/api/v1/blogs/posts/search?q=alpha").expect(200);
    expect(searchContent.body.data).toHaveLength(2);

    const paged = await request(app).get("/api/v1/blogs/posts/search?q=alpha&limit=1&offset=1").expect(200);
    expect(paged.body.data).toHaveLength(1);
  });

  it("does not return posts from private blogs in public search", async () => {
    const owner = makeTestUser();
    const token = await createAuthToken(owner);
    const publicBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Public Blog", visibility: "public" })
      .expect(201);

    const privateOwner = makeTestUser();
    const privateToken = await createAuthToken(privateOwner);
    const privateBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${privateToken}`)
      .send({ title: "Private Blog", visibility: "private" })
      .expect(201);

    await request(app)
      .post(`/api/v1/blogs/${publicBlog.body.data.slug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Public Post", content: "Visible content" })
      .expect(201);

    await request(app)
      .post(`/api/v1/blogs/${privateBlog.body.data.slug}/posts`)
      .set("Authorization", `Bearer ${privateToken}`)
      .send({ title: "Private Post", content: "Hidden content" })
      .expect(201);

    const search = await request(app).get("/api/v1/blogs/posts/search?q=content").expect(200);
    expect(search.body.data.some((post) => post.title === "Private Post")).toBe(false);
    expect(search.body.data.some((post) => post.title === "Public Post")).toBe(true);
  });

  it("returns all public blogs and supports pagination when no search query is provided", async () => {
    const owner1 = makeTestUser();
    const token1 = await createAuthToken(owner1);
    const owner2 = makeTestUser();
    const token2 = await createAuthToken(owner2);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token1}`)
      .send({ title: "Public One", visibility: "public" })
      .expect(201);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token2}`)
      .send({ title: "Public Two", visibility: "public" })
      .expect(201);

    const allBlogs = await request(app).get("/api/v1/blogs/search").expect(200);
    expect(allBlogs.body.data.length).toBeGreaterThanOrEqual(2);

    const paged = await request(app).get("/api/v1/blogs/search?limit=1&offset=1").expect(200);
    expect(paged.body.data.length).toBe(1);
  });

  it("returns all public posts and supports pagination when no search query is provided", async () => {
    const owner = makeTestUser();
    const token = await createAuthToken(owner);
    const blogRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Public Blog Posts", visibility: "public" })
      .expect(201);

    const blogSlug = blogRes.body.data.slug;

    await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Post One", content: "One" })
      .expect(201);

    await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Post Two", content: "Two" })
      .expect(201);

    const allPosts = await request(app).get("/api/v1/blogs/posts/search").expect(200);
    expect(allPosts.body.data.length).toBeGreaterThanOrEqual(2);

    const paged = await request(app).get("/api/v1/blogs/posts/search?limit=1&offset=1").expect(200);
    expect(paged.body.data.length).toBe(1);
  });
});
