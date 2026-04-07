import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const app = require("../../api/index.js");
const dbManager = require("../../data/database-manager");

describe("Farmlog Blog API", () => {
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
      email: `farmlog_${Date.now()}_${random}@test.com`,
      displayedName: "Farmlog Tester",
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
    await patchFlags({ rolnopolFarmlogEnabled: true });
  });

  afterEach(async () => {
    await replaceFlags(originalFlags);
    await dbManager.getBlogsDatabase().replaceAll([]);
  });

  it("creates, lists, retrieves, updates, and deletes a blog", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const createRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "My Test Farmlog", visibility: "public" })
      .expect(201);

    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data).toHaveProperty("slug", "my-test-farmlog");
    expect(createRes.body.data).toHaveProperty("visibility", "public");
    expect(createRes.body.data).toHaveProperty("userId");

    const slug = createRes.body.data.slug;

    const listRes = await request(app).get("/api/v1/blogs").expect(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "my-test-farmlog", title: "My Test Farmlog" })]),
    );

    const detailRes = await request(app).get(`/api/v1/blogs/${slug}`).expect(200);
    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data).toHaveProperty("slug", slug);
    expect(detailRes.body.data).toHaveProperty("title", "My Test Farmlog");

    const updateRes = await request(app)
      .patch(`/api/v1/blogs/${slug}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated Farmlog Title" })
      .expect(200);

    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.data).toHaveProperty("title", "Updated Farmlog Title");
    expect(updateRes.body.data).toHaveProperty("slug", "updated-farmlog-title");

    const deleteRes = await request(app)
      .delete(`/api/v1/blogs/${updateRes.body.data.slug}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.data).toHaveProperty("slug", "updated-farmlog-title");
    expect(deleteRes.body.data).toHaveProperty("deletedAt");

    await request(app).get(`/api/v1/blogs/${deleteRes.body.data.slug}`).set("Authorization", `Bearer ${token}`).expect(404);

    const postDeleteList = await request(app).get("/api/v1/blogs").set("Authorization", `Bearer ${token}`).expect(200);

    expect(postDeleteList.body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug: deleteRes.body.data.slug })]));
  });

  it("allows creating a new blog after soft delete", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const firstBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Transient Blog", visibility: "public" })
      .expect(201);

    await request(app).delete(`/api/v1/blogs/${firstBlog.body.data.slug}`).set("Authorization", `Bearer ${token}`).expect(200);

    const secondBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Recreated Blog", visibility: "public" })
      .expect(201);

    expect(secondBlog.body.data.slug).not.toBe(firstBlog.body.data.slug);
    expect(secondBlog.body.data.title).toBe("Recreated Blog");
  });

  it("supports blog listing pagination", async () => {
    const user1 = makeTestUser();
    const token1 = await createAuthToken(user1);
    const user2 = makeTestUser();
    const token2 = await createAuthToken(user2);
    const user3 = makeTestUser();
    const token3 = await createAuthToken(user3);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token1}`)
      .send({ title: "Paginated One", visibility: "public" })
      .expect(201);
    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token2}`)
      .send({ title: "Paginated Two", visibility: "public" })
      .expect(201);
    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token3}`)
      .send({ title: "Paginated Three", visibility: "public" })
      .expect(201);

    const paged = await request(app).get("/api/v1/blogs?limit=1&offset=1").expect(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0]).toHaveProperty("title");
  });

  it("reuses the same slug after soft deleting a blog with the same title", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const firstBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Reused Blog", visibility: "public" })
      .expect(201);

    await request(app).delete(`/api/v1/blogs/${firstBlog.body.data.slug}`).set("Authorization", `Bearer ${token}`).expect(200);

    const secondBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Reused Blog", visibility: "public" })
      .expect(201);

    expect(secondBlog.body.data.slug).toBe(firstBlog.body.data.slug);
    expect(secondBlog.body.data.title).toBe("Reused Blog");
  });

  it("reuses the same slug after soft deleting a private blog and creating a public blog", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const firstBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Transition Blog", visibility: "private" })
      .expect(201);

    await request(app).delete(`/api/v1/blogs/${firstBlog.body.data.slug}`).set("Authorization", `Bearer ${token}`).expect(200);

    const secondBlog = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Transition Blog", visibility: "public" })
      .expect(201);

    expect(secondBlog.body.data.slug).toBe(firstBlog.body.data.slug);
    expect(secondBlog.body.data.visibility).toBe("public");
  });

  it("rejects second blog creation for the same user", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "First Farmlog", visibility: "public" })
      .expect(201);

    const duplicateRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Second Farmlog", visibility: "public" })
      .expect(409);

    expect(duplicateRes.body.success).toBe(false);
    expect(duplicateRes.body.error).toContain("Each user may only create one active blog");
  });

  it("supports explicit slug and tags, and allows searching by tag", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const createRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Special Blog!",
        slug: "Custom SLUG",
        visibility: "public",
        tags: ["Agriculture", "  farming  "],
      })
      .expect(201);

    expect(createRes.body.data).toMatchObject({
      slug: "custom-slug",
      visibility: "public",
      tags: ["Agriculture", "farming"],
    });

    const searchRes = await request(app).get("/api/v1/blogs?search=farming").expect(200);
    expect(searchRes.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "custom-slug" })]));
  });

  it("hides private blogs from anonymous users but shows them to the owner", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const createRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Private Blog", visibility: "private" })
      .expect(201);

    const slug = createRes.body.data.slug;

    const publicList = await request(app).get("/api/v1/blogs").expect(200);
    expect(publicList.body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));

    await request(app).get(`/api/v1/blogs/${slug}`).expect(404);

    const ownerDetail = await request(app).get(`/api/v1/blogs/${slug}`).set("Authorization", `Bearer ${token}`).expect(200);

    expect(ownerDetail.body.data).toHaveProperty("slug", slug);
    expect(ownerDetail.body.data).toHaveProperty("visibility", "private");
  });

  it("rejects invalid blog creation payloads", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    await request(app).post("/api/v1/blogs").set("Authorization", `Bearer ${token}`).send({ title: "", visibility: "public" }).expect(400);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Valid Title", visibility: "unknown" })
      .expect(400);

    await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Valid Title",
        visibility: "public",
        tags: ["a", "b", "c", "d", "e", "f"],
      })
      .expect(400);
  });

  it("rejects update when no valid fields are provided", async () => {
    const user = makeTestUser();
    const token = await createAuthToken(user);

    const createRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updatable Blog", visibility: "public" })
      .expect(201);

    await request(app)
      .patch(`/api/v1/blogs/${createRes.body.data.slug}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ unknownField: "x" })
      .expect(400);
  });

  it("rejects unauthorized updates and deletes from other users", async () => {
    const owner = makeTestUser();
    const ownerToken = await createAuthToken(owner);

    const other = makeTestUser();
    const otherToken = await createAuthToken(other);

    const createRes = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Owner Blog", visibility: "public" })
      .expect(201);

    await request(app)
      .patch(`/api/v1/blogs/${createRes.body.data.slug}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Hacked Title" })
      .expect(403);

    await request(app).delete(`/api/v1/blogs/${createRes.body.data.slug}`).set("Authorization", `Bearer ${otherToken}`).expect(403);
  });

  it("auto-resolves slug collisions when updating a blog slug", async () => {
    const user1 = makeTestUser();
    const token1 = await createAuthToken(user1);
    const user2 = makeTestUser();
    const token2 = await createAuthToken(user2);

    const blog1 = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token1}`)
      .send({ title: "Blog One", visibility: "public" })
      .expect(201);

    const blog2 = await request(app)
      .post("/api/v1/blogs")
      .set("Authorization", `Bearer ${token2}`)
      .send({ title: "Blog Two", visibility: "public" })
      .expect(201);

    const updateRes = await request(app)
      .patch(`/api/v1/blogs/${blog1.body.data.slug}`)
      .set("Authorization", `Bearer ${token1}`)
      .send({ slug: blog2.body.data.slug })
      .expect(200);

    expect(updateRes.body.data.slug).toBe(`${blog2.body.data.slug}-2`);
  });

  it("returns 404 when the Farmlog feature is disabled", async () => {
    await patchFlags({ rolnopolFarmlogEnabled: false });

    const res = await request(app).get("/api/v1/blogs").expect(404);
    expect(res.body.success).toBe(false);
  });
});
