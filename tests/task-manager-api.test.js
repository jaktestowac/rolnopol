import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const featureFlagsService = require("../services/feature-flags.service");

async function restoreBaseState() {
  await request(app).post("/api/debug/database/restore-base").expect(200);
}

async function enableTaskManager() {
  await featureFlagsService.updateFlags({ taskManagerEnabled: true });
}

async function registerUser(label = "task-user") {
  const user = {
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
    displayedName: "Task User",
    password: "testpass123",
  };

  const response = await request(app).post("/api/v1/register").send(user).expect(201);

  return {
    user,
    token: response.body.data.token,
    userId: response.body.data.user.id,
  };
}

async function createStaff(session, payload = {}) {
  const response = await request(app)
    .post("/api/v1/staff")
    .set("token", session.token)
    .send({
      name: "Casey",
      surname: "Field",
      age: 31,
      ...payload,
    })
    .expect(201);

  return response.body.data;
}

async function createLabel(session, payload = {}) {
  const response = await request(app)
    .post("/api/v1/tasks/labels")
    .set("token", session.token)
    .send({
      name: "Urgent",
      color: "#C53030",
      ...payload,
    })
    .expect(201);

  return response.body.data.label;
}

async function createStatus(session, payload = {}) {
  const response = await request(app)
    .post("/api/v1/tasks/statuses")
    .set("token", session.token)
    .send({
      name: "Review",
      ...payload,
    })
    .expect(201);

  return response.body.data.status;
}

async function createTask(session, payload = {}) {
  const response = await request(app)
    .post("/api/v1/tasks")
    .set("token", session.token)
    .send({
      title: "Inspect irrigation",
      description: "Check the south field irrigation line.",
      ...payload,
    })
    .expect(201);

  return response.body.data.task;
}

describe("Task manager API", () => {
  beforeEach(async () => {
    await restoreBaseState();
  });

  it("hides task endpoints while feature flag is disabled", async () => {
    const session = await registerUser("task-disabled");

    const response = await request(app).get("/api/v1/tasks").set("token", session.token).expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("Task manager not found");
  });

  it("requires authentication when feature flag is enabled", async () => {
    await enableTaskManager();

    const response = await request(app).get("/api/v1/tasks").expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("Access token required");
  });

  it("creates default statuses lazily and creates a task for the authenticated user", async () => {
    await enableTaskManager();
    const session = await registerUser("task-create");

    const statusesRes = await request(app).get("/api/v1/tasks/statuses").set("token", session.token).expect(200);
    expect(statusesRes.body.data.items.map((status) => status.name)).toEqual(["Backlog", "Inprogress", "Done", "Archive"]);

    const task = await createTask(session);
    expect(task.title).toBe("Inspect irrigation");
    expect(task.description).toBe("Check the south field irrigation line.");
    expect(task.status.name).toBe("Backlog");

    const listRes = await request(app).get("/api/v1/tasks").set("token", session.token).expect(200);
    expect(listRes.body.data.items).toHaveLength(1);
    expect(listRes.body.data.items[0].id).toBe(task.id);
  });

  it("validates required task fields and field limits", async () => {
    await enableTaskManager();
    const session = await registerUser("task-validation");

    const missing = await request(app).post("/api/v1/tasks").set("token", session.token).send({ title: "" }).expect(400);
    expect(missing.body.error).toContain("description is required");

    const tooLong = await request(app)
      .post("/api/v1/tasks")
      .set("token", session.token)
      .send({
        title: "x".repeat(121),
        description: "Valid description",
      })
      .expect(400);
    expect(tooLong.body.error).toContain("title must be at most 120 characters");
  });

  it("validates due date, recurrence, color, and checklist limits", async () => {
    await enableTaskManager();
    const session = await registerUser("task-optional-validation");

    const response = await request(app)
      .post("/api/v1/tasks")
      .set("token", session.token)
      .send({
        title: "Prepare report",
        description: "Monthly work package.",
        dueDate: "2026-02-31",
        recurring: { enabled: true, frequency: "hourly", interval: 25 },
        color: "green",
        checklist: Array.from({ length: 31 }, (_, index) => ({ text: `Item ${index}` })),
      })
      .expect(400);

    expect(response.body.error).toContain("dueDate must be a valid YYYY-MM-DD date");
    expect(response.body.error).toContain("recurring.frequency");
    expect(response.body.error).toContain("recurring.interval");
    expect(response.body.error).toContain("color must be a valid #RRGGBB color");
    expect(response.body.error).toContain("checklist must contain at most 30 items");
  });

  it("creates labels, enforces uniqueness, filters by label, and removes deleted labels from tasks", async () => {
    await enableTaskManager();
    const session = await registerUser("task-labels");
    const label = await createLabel(session, { name: "Harvest", color: "#2F855A" });

    await request(app).post("/api/v1/tasks/labels").set("token", session.token).send({ name: "harvest", color: "#2F855A" }).expect(400);

    const task = await createTask(session, { title: "Harvest field", labelIds: [label.id] });
    expect(task.labelIds).toEqual([label.id]);

    const filtered = await request(app).get(`/api/v1/tasks?labelId=${label.id}`).set("token", session.token).expect(200);
    expect(filtered.body.data.items).toHaveLength(1);

    await request(app).delete(`/api/v1/tasks/labels/${label.id}`).set("token", session.token).expect(200);
    const updated = await request(app).get(`/api/v1/tasks/${task.id}`).set("token", session.token).expect(200);
    expect(updated.body.data.task.labelIds).toEqual([]);
  });

  it("creates custom statuses, moves tasks, reorders statuses, and prevents archiving defaults", async () => {
    await enableTaskManager();
    const session = await registerUser("task-statuses");
    const customStatus = await createStatus(session, { name: "Blocked" });
    const task = await createTask(session);

    const moved = await request(app)
      .patch(`/api/v1/tasks/${task.id}/move`)
      .set("token", session.token)
      .send({ statusId: customStatus.id, position: 1 })
      .expect(200);
    expect(moved.body.data.task.statusId).toBe(customStatus.id);

    const statusesRes = await request(app).get("/api/v1/tasks/statuses").set("token", session.token).expect(200);
    const backlog = statusesRes.body.data.items.find((status) => status.name === "Backlog");
    const order = [customStatus.id, backlog.id];
    const reordered = await request(app).patch("/api/v1/tasks/statuses/reorder").set("token", session.token).send({ order }).expect(200);
    expect(reordered.body.data.statuses.find((status) => status.id === customStatus.id).position).toBe(1);

    const archiveDefault = await request(app).post(`/api/v1/tasks/statuses/${backlog.id}/archive`).set("token", session.token).expect(400);
    expect(archiveDefault.body.error).toContain("default statuses cannot be archived");
  });

  it("searches and filters tasks by status, assignee, recurrence, due date, and archived state", async () => {
    await enableTaskManager();
    const session = await registerUser("task-filters");
    const staff = await createStaff(session);
    const status = await createStatus(session, { name: "Next" });
    const task = await createTask(session, {
      title: "Seed order",
      description: "Order seed for north field",
      statusId: status.id,
      assigneeStaffId: staff.id,
      dueDate: "2026-06-01",
      recurring: { enabled: true, frequency: "weekly", interval: 1 },
      color: "#2F855A",
    });
    await createTask(session, { title: "Other task", description: "Different work" });

    const filtered = await request(app)
      .get(
        `/api/v1/tasks?search=seed&statusId=${status.id}&assigneeStaffId=${staff.id}&recurring=true&dueFrom=2026-05-01&dueTo=2026-06-30&color=%232F855A&sort=dueDate&order=asc&view=swimlane`,
      )
      .set("token", session.token)
      .expect(200);

    expect(filtered.body.data.view).toBe("swimlane");
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].id).toBe(task.id);

    await request(app).post(`/api/v1/tasks/${task.id}/archive`).set("token", session.token).expect(200);

    const activeOnly = await request(app).get("/api/v1/tasks").set("token", session.token).expect(200);
    expect(activeOnly.body.data.items.find((item) => item.id === task.id)).toBeUndefined();

    const archived = await request(app).get("/api/v1/tasks?archived=true").set("token", session.token).expect(200);
    expect(archived.body.data.items.find((item) => item.id === task.id)).toBeTruthy();
  });

  it("restores archived tasks to Backlog by default", async () => {
    await enableTaskManager();
    const session = await registerUser("task-restore");
    const task = await createTask(session);

    await request(app).post(`/api/v1/tasks/${task.id}/archive`).set("token", session.token).expect(200);
    const restored = await request(app).post(`/api/v1/tasks/${task.id}/restore`).set("token", session.token).send({}).expect(200);

    expect(restored.body.data.task.archivedAt).toBeNull();
    expect(restored.body.data.task.status.name).toBe("Backlog");
  });

  it("isolates tasks, labels, statuses, and staff assignees per user", async () => {
    await enableTaskManager();
    const userA = await registerUser("task-user-a");
    const userB = await registerUser("task-user-b");
    const userAStaff = await createStaff(userA);
    const labelA = await createLabel(userA, { name: "Private" });
    const statusA = await createStatus(userA, { name: "Private Status" });
    const taskA = await createTask(userA, { labelIds: [labelA.id], statusId: statusA.id, assigneeStaffId: userAStaff.id });

    await request(app).get(`/api/v1/tasks/${taskA.id}`).set("token", userB.token).expect(404);
    await request(app).patch(`/api/v1/tasks/${taskA.id}`).set("token", userB.token).send({ title: "Nope" }).expect(404);
    await request(app)
      .post("/api/v1/tasks")
      .set("token", userB.token)
      .send({
        title: "Invalid assignment",
        description: "Should fail",
        assigneeStaffId: userAStaff.id,
      })
      .expect(400);

    const userBList = await request(app).get("/api/v1/tasks").set("token", userB.token).expect(200);
    expect(userBList.body.data.items).toHaveLength(0);
  });

  it("allows assigning a task to the authenticated user", async () => {
    await enableTaskManager();
    const session = await registerUser("task-self-assign");

    const task = await createTask(session, {
      title: "Own the follow-up",
      description: "Track the follow-up myself.",
      assigneeStaffId: session.userId,
      selfAssigned: true,
    });

    expect(task.selfAssigned).toBe(true);
    expect(task.assigneeStaffId).toBe(session.userId);

    const filtered = await request(app).get("/api/v1/tasks?selfAssigned=true").set("token", session.token).expect(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].id).toBe(task.id);
  });
});
