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

describe("Farmlog Search API", () => {
  async function patchFlags(flags) {
    await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
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

  describe("discovery feed paging", () => {
    async function seedFeed(count, titlePrefix = "Feed post") {
      const owner = makeTestUser();
      const token = await createAuthToken(owner);
      const blogRes = await request(app)
        .post("/api/v1/blogs")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: `Feed Blog ${Date.now()}`, visibility: "public" })
        .expect(201);
      const blogSlug = blogRes.body.data.slug;

      for (let i = 1; i <= count; i += 1) {
        await request(app)
          .post(`/api/v1/blogs/${blogSlug}/posts`)
          .set("Authorization", `Bearer ${token}`)
          .send({ title: `${titlePrefix} ${i}`, content: `Body ${i}` })
          .expect(201);
      }

      return { token, blogSlug };
    }

    const idsOf = (res) => res.body.data.map((post) => post.id);
    const pagingOf = (res) => res.body.meta.paging;

    it("reports the window it answered without changing the shape of `data`", async () => {
      await seedFeed(5);

      const first = await request(app).get("/api/v1/blogs/posts/search?page=0&size=2").expect(200);
      expect(Array.isArray(first.body.data)).toBe(true); // unchanged contract
      expect(first.body.data).toHaveLength(2);
      expect(pagingOf(first)).toMatchObject({ mode: "offset", page: 0, size: 2, returned: 2, hasMore: true });
      expect(pagingOf(first).total).toBeGreaterThanOrEqual(5);
      expect(typeof pagingOf(first).nextCursor).toBe("string");

      // An unparameterised search still answers everything, exactly as before.
      const unpaged = await request(app).get("/api/v1/blogs/posts/search").expect(200);
      expect(unpaged.body.data.length).toBe(pagingOf(first).total);
      expect(pagingOf(unpaged).hasMore).toBe(false);
    });

    it("walks the whole feed in either mode when nothing is published underneath", async () => {
      await seedFeed(5);
      const total = pagingOf(await request(app).get("/api/v1/blogs/posts/search?page=0&size=2").expect(200)).total;

      const byOffset = [];
      for (let page = 0; ; page += 1) {
        const res = await request(app).get(`/api/v1/blogs/posts/search?page=${page}&size=2`).expect(200);
        byOffset.push(...idsOf(res));
        if (!pagingOf(res).hasMore) break;
      }

      const byCursor = [];
      let cursor = null;
      for (;;) {
        const query = `paging=cursor&size=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await request(app).get(`/api/v1/blogs/posts/search?${query}`).expect(200);
        byCursor.push(...idsOf(res));
        cursor = pagingOf(res).nextCursor;
        if (!pagingOf(res).hasMore) break;
      }

      // A still feed is the easy case: both modes agree, and both are complete.
      expect(byOffset).toHaveLength(total);
      expect(byCursor).toEqual(byOffset);
      expect(new Set(byOffset).size).toBe(total);
    });

    it("offset paging DUPLICATES a row when a post is published mid-scroll; the cursor twin does not", async () => {
      const { token, blogSlug } = await seedFeed(4);

      // Read page 0 in both modes, from the same state.
      const offsetPage0 = await request(app).get("/api/v1/blogs/posts/search?page=0&size=2").expect(200);
      const cursorPage0 = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&size=2").expect(200);
      expect(idsOf(cursorPage0)).toEqual(idsOf(offsetPage0));

      // Somebody publishes. Newest-first means it lands ABOVE both windows, so every
      // row the reader already has shifts down one.
      await request(app)
        .post(`/api/v1/blogs/${blogSlug}/posts`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Published mid-scroll", content: "Arrived while you were reading" })
        .expect(201);

      // Offset asks for "rows 2-3" and gets a row it has already shown. This is the
      // defect the mode has by construction — asserted, not tolerated by accident.
      const offsetPage1 = await request(app).get("/api/v1/blogs/posts/search?page=1&size=2").expect(200);
      const offsetSeen = [...idsOf(offsetPage0), ...idsOf(offsetPage1)];
      expect(new Set(offsetSeen).size).toBeLessThan(offsetSeen.length);

      // The cursor asks for "after that post" and gets exactly that.
      const cursorPage1 = await request(app)
        .get(`/api/v1/blogs/posts/search?paging=cursor&size=2&cursor=${encodeURIComponent(pagingOf(cursorPage0).nextCursor)}`)
        .expect(200);
      const cursorSeen = [...idsOf(cursorPage0), ...idsOf(cursorPage1)];
      expect(new Set(cursorSeen).size).toBe(cursorSeen.length);
      for (const id of idsOf(cursorPage0)) expect(idsOf(cursorPage1)).not.toContain(id);
    });

    it("offset paging SKIPS a row when a post above the window is deleted; the cursor twin does not", async () => {
      const { token, blogSlug } = await seedFeed(5);

      const offsetPage0 = await request(app).get("/api/v1/blogs/posts/search?page=0&size=2").expect(200);
      const cursorPage0 = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&size=2").expect(200);

      // Remove the newest post — everything below it shifts UP by one.
      const newest = offsetPage0.body.data[0];
      await request(app).delete(`/api/v1/blogs/${blogSlug}/posts/${newest.slug}`).set("Authorization", `Bearer ${token}`).expect(200);

      const remaining = pagingOf(await request(app).get("/api/v1/blogs/posts/search").expect(200)).total;

      const offsetPage1 = await request(app).get("/api/v1/blogs/posts/search?page=1&size=2").expect(200);
      const offsetSeen = [...idsOf(offsetPage0).slice(1), ...idsOf(offsetPage1)];

      const cursorPage1 = await request(app)
        .get(`/api/v1/blogs/posts/search?paging=cursor&size=2&cursor=${encodeURIComponent(pagingOf(cursorPage0).nextCursor)}`)
        .expect(200);
      const cursorSeen = [...idsOf(cursorPage0).slice(1), ...idsOf(cursorPage1)];

      // The reader keeps scrolling to the end in both modes; only one of them ends up
      // having been shown every surviving post.
      const walkToEnd = async (mode, seen, startCursor, startPage) => {
        const out = [...seen];
        if (mode === "cursor") {
          let cursor = startCursor;
          for (;;) {
            const res = await request(app)
              .get(`/api/v1/blogs/posts/search?paging=cursor&size=2&cursor=${encodeURIComponent(cursor)}`)
              .expect(200);
            if (!idsOf(res).length) break;
            out.push(...idsOf(res));
            cursor = pagingOf(res).nextCursor;
            if (!pagingOf(res).hasMore) break;
          }
          return out;
        }
        for (let page = startPage; ; page += 1) {
          const res = await request(app).get(`/api/v1/blogs/posts/search?page=${page}&size=2`).expect(200);
          out.push(...idsOf(res));
          if (!pagingOf(res).hasMore) break;
        }
        return out;
      };

      const offsetAll = await walkToEnd("offset", offsetSeen, null, 2);
      const cursorAll = await walkToEnd("cursor", cursorSeen, pagingOf(cursorPage1).nextCursor, 0);

      // Cursor showed every surviving post exactly once; offset missed one.
      expect(new Set(cursorAll).size).toBe(remaining);
      expect(new Set(offsetAll).size).toBeLessThan(remaining);
    });

    it("clamps the page size and treats a cursor it cannot resolve as the end, not the top", async () => {
      await seedFeed(3);

      const clamped = await request(app).get("/api/v1/blogs/posts/search?page=0&size=99999").expect(200);
      expect(pagingOf(clamped).size).toBe(100);

      // A cursor from a deleted post still resolves BY POSITION under a time-ordered
      // sort, so paging resumes instead of silently restarting at the top.
      const head = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&size=1").expect(200);
      const stale = `${Date.parse(head.body.data[0].createdAt) - 1}_999999`;
      const resumed = await request(app)
        .get(`/api/v1/blogs/posts/search?paging=cursor&size=10&cursor=${encodeURIComponent(stale)}`)
        .expect(200);
      expect(pagingOf(resumed).cursorLost).toBeUndefined();
      expect(idsOf(resumed)).not.toContain(head.body.data[0].id);

      // A cursor that cannot mean anything under this sort says so.
      const lost = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&sort=title-asc&cursor=not-a-cursor").expect(200);
      expect(pagingOf(lost).cursorLost).toBe(true);
      expect(lost.body.data).toEqual([]);
    });

    it("warns that most-liked is an unstable sort, because a cursor cannot fix a moving order", async () => {
      await patchFlags({ rolnopolFarmlogEngagementEnabled: true });
      await seedFeed(3);

      const newest = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&size=2").expect(200);
      expect(pagingOf(newest).unstableSort).toBe(false);

      const liked = await request(app).get("/api/v1/blogs/posts/search?paging=cursor&size=2&sort=most-liked").expect(200);
      expect(pagingOf(liked).unstableSort).toBe(true);
      expect(pagingOf(liked).sort).toBe("most-liked");
    });
  });

  it("sorts posts by most liked and respects the selected period when engagement flag is enabled", async () => {
    await patchFlags({ rolnopolFarmlogEngagementEnabled: true });

    const owner = makeTestUser();
    const token = await createAuthToken(owner);
    const blogRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Most Liked Blog", visibility: "public" })
      .expect(201);

    const blogSlug = blogRes.body.data.slug;

    const firstRes = await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Recent Champion", content: "Recent likes win." })
      .expect(201);

    const secondRes = await request(app)
      .post(`/api/v1/blogs/${blogSlug}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "All-time Champion", content: "Historic likes win." })
      .expect(201);

    const now = new Date().toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    await dbManager.getPostLikesDatabase().replaceAll([
      { id: 1, userId: 11, postId: firstRes.body.data.id, blogId: blogRes.body.data.id, createdAt: now, updatedAt: now },
      { id: 2, userId: 12, postId: firstRes.body.data.id, blogId: blogRes.body.data.id, createdAt: threeDaysAgo, updatedAt: threeDaysAgo },
      { id: 3, userId: 21, postId: secondRes.body.data.id, blogId: blogRes.body.data.id, createdAt: now, updatedAt: now },
      { id: 4, userId: 22, postId: secondRes.body.data.id, blogId: blogRes.body.data.id, createdAt: fortyDaysAgo, updatedAt: fortyDaysAgo },
      { id: 5, userId: 23, postId: secondRes.body.data.id, blogId: blogRes.body.data.id, createdAt: fortyDaysAgo, updatedAt: fortyDaysAgo },
    ]);

    const recentTop = await request(app).get("/api/v1/blogs/posts/search?sort=most-liked&period=7d").expect(200);
    expect(recentTop.body.data[0]).toMatchObject({
      slug: firstRes.body.data.slug,
      likesCount: 2,
      periodLikesCount: 2,
    });

    const allTimeTop = await request(app).get("/api/v1/blogs/posts/search?sort=most-liked&period=all").expect(200);
    expect(allTimeTop.body.data[0]).toMatchObject({
      slug: secondRes.body.data.slug,
      likesCount: 3,
      periodLikesCount: 3,
    });
  });
});
