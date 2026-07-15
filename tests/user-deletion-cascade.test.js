import { describe, it, expect } from "vitest";
import request from "supertest";

// End-to-end regression guard for refactor #2's delete cascade. Exercises the
// FULL chain through the running app — app-boot lifecycle wiring → UserDatabase
// emit → user-lifecycle dispatch → resource.service self-registered handler →
// real ResourceService.cascadeDelete data cleanup — which the unit tests only
// cover link-by-link (with cascadeDelete mocked). Also asserts cross-user
// isolation (deleting one user must not touch another user's resources).

const app = require("../api/index.js");
const dbManager = require("../data/database-manager");

async function registerUserWithStaff(suffix) {
  const email = `cascade-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const reg = await request(app)
    .post("/api/v1/register")
    .send({ email, displayedName: "Cascade User", password: "testpass123" })
    .expect(201);

  const token = reg.body.data.token;
  const userId = reg.body.data.user.id;

  await request(app).post("/api/v1/staff").set("token", token).send({ name: "Hand", surname: suffix, age: 30 }).expect(201);

  return { token, userId };
}

const staffCountFor = async (userId) => {
  const all = await dbManager.getStaffDatabase().getAll();
  return (Array.isArray(all) ? all : []).filter((s) => Number(s.userId) === Number(userId)).length;
};

describe("user deletion cascades to resource cleanup (end-to-end, #2)", () => {
  it("removes the deleted user's staff while leaving other users' staff intact", async () => {
    const userA = await registerUserWithStaff("A");
    const userB = await registerUserWithStaff("B");

    // Precondition: both users own staff resources.
    expect(await staffCountFor(userA.userId)).toBeGreaterThan(0);
    expect(await staffCountFor(userB.userId)).toBeGreaterThan(0);

    // Delete user A (self-delete) — the cascade is awaited before the response.
    await request(app).delete("/api/v1/users/profile").set("token", userA.token).expect(200);

    // A's resources are cascade-deleted; B's are untouched.
    expect(await staffCountFor(userA.userId)).toBe(0);
    expect(await staffCountFor(userB.userId)).toBeGreaterThan(0);
  });
});
