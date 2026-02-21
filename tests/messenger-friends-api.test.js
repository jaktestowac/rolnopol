import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setMessengerEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { messengerEnabled: enabled } })
    .expect(200);
}

async function createAndLoginUser() {
  const email = `messenger_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "testpass123";

  await request(app).post("/api/v1/register").send({ email, password, displayedName: "Messenger User" }).expect(201);

  const loginRes = await request(app).post("/api/v1/login").send({ email, password }).expect(200);

  return {
    token: loginRes.body?.data?.token,
    user: loginRes.body?.data?.user,
  };
}

describe("Messenger Friends API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns 404 when messenger feature flag is disabled", async () => {
    await setMessengerEnabled(false);

    const res = await request(app).get("/api/v1/users/friends").expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Messenger not found");
  });

  it("returns 401 when messenger is enabled but auth token is missing", async () => {
    await setMessengerEnabled(true);

    const res = await request(app).get("/api/v1/users/friends").expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Access token required");
  });

  it("returns 403 when messenger is enabled but auth token is invalid", async () => {
    await setMessengerEnabled(true);

    const res = await request(app).get("/api/v1/users/friends").set("token", "definitely-invalid-token").expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Invalid or expired token");
  });

  it("returns 404 for friend add when messenger feature flag is disabled (gated before auth)", async () => {
    await setMessengerEnabled(false);

    const res = await request(app).post("/api/v1/users/friends").send({ identifier: "demo" }).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Messenger not found");
  });

  it("adds friend by username", async () => {
    await setMessengerEnabled(true);
    const { token } = await createAndLoginUser();

    const res = await request(app).post("/api/v1/users/friends").set("token", token).send({ identifier: "demo" }).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.friend).toHaveProperty("id");
    expect(res.body.data.friend.username).toBe("demo");
  });

  it("adds friend by email", async () => {
    await setMessengerEnabled(true);
    const { token } = await createAndLoginUser();

    const res = await request(app)
      .post("/api/v1/users/friends")
      .set("token", token)
      .send({ identifier: "john.doe@example.com" })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.friend.email).toBe("john.doe@example.com");
  });

  it("rejects duplicate friend add with 409", async () => {
    await setMessengerEnabled(true);
    const { token } = await createAndLoginUser();

    await request(app).post("/api/v1/users/friends").set("token", token).send({ identifier: "demo" }).expect(201);

    const duplicateRes = await request(app).post("/api/v1/users/friends").set("token", token).send({ identifier: "demo" }).expect(409);

    expect(duplicateRes.body.success).toBe(false);
    expect(duplicateRes.body.error).toContain("already");
  });

  it("lists friends and allows unilateral removal", async () => {
    await setMessengerEnabled(true);
    const { token } = await createAndLoginUser();

    const addRes = await request(app).post("/api/v1/users/friends").set("token", token).send({ identifier: "demo" }).expect(201);

    const friendId = addRes.body?.data?.friend?.id;
    expect(Number.isInteger(friendId)).toBe(true);

    const listRes = await request(app).get("/api/v1/users/friends").set("token", token).expect(200);

    expect(listRes.body.success).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.some((item) => item.id === friendId)).toBe(true);

    await request(app).delete(`/api/v1/users/friends/${friendId}`).set("token", token).expect(200);

    const listAfterRemove = await request(app).get("/api/v1/users/friends").set("token", token).expect(200);

    expect(listAfterRemove.body.data.some((item) => item.id === friendId)).toBe(false);
  });

  it("returns 400 for invalid friendUserId format when deleting friend", async () => {
    await setMessengerEnabled(true);
    const { token } = await createAndLoginUser();

    const res = await request(app).delete("/api/v1/users/friends/not-a-number").set("token", token).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Invalid friendUserId format");
  });
});
