import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB BEFORE requiring the modules (they read env on load).
const TMP_DB = path.join(os.tmpdir(), `tasklab-service-test-${process.pid}.json`);
process.env.TASKLAB_DB_PATH = TMP_DB;
process.env.TASKLAB_LOG = "silent";

const tasklabDb = require("../../external-services/tasklab/tasklab-server/db.js");
const tasklabService = require("../../external-services/tasklab/tasklab-server/tasklab.service.js");

const USER = "user-1";
const OTHER = "user-2";

beforeAll(async () => {
  await tasklabDb.init();
});

beforeEach(async () => {
  await tasklabDb.db.replaceAll({ version: 1, users: {}, updatedAt: null });
});

afterAll(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("tasklab.service — statuses & limits", () => {
  it("exposes the status catalog and length limits", () => {
    const { statuses, max_title_length, max_content_length } = tasklabService.listStatuses();
    expect(statuses.map((s) => s.id)).toEqual(["open", "in_progress", "blocked", "done"]);
    expect(max_title_length).toBe(120);
    expect(max_content_length).toBe(2000);
  });
});

describe("tasklab.service — createTask", () => {
  it("creates a task that defaults to open + not archived", async () => {
    const task = await tasklabService.createTask(USER, { title: "Water the plants", content: "All of them" });
    expect(task.id).toBe("task-1");
    expect(task.title).toBe("Water the plants");
    expect(task.status).toBe("open");
    expect(task.archived).toBe(false);
    expect(task.created_at).toBeTruthy();
  });

  it("trims the title and increments ids per user", async () => {
    const a = await tasklabService.createTask(USER, { title: "  one  " });
    const b = await tasklabService.createTask(USER, { title: "two" });
    expect(a.title).toBe("one");
    expect(a.id).toBe("task-1");
    expect(b.id).toBe("task-2");
  });

  it("rejects an empty title", async () => {
    await expect(tasklabService.createTask(USER, { title: "   " })).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });

  it("rejects a title over the max length", async () => {
    const long = "x".repeat(tasklabService.MAX_TITLE_LENGTH + 1);
    await expect(tasklabService.createTask(USER, { title: long })).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });

  it("rejects content over the max length", async () => {
    const long = "y".repeat(tasklabService.MAX_CONTENT_LENGTH + 1);
    await expect(tasklabService.createTask(USER, { title: "ok", content: long })).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });

  it("requires a user identity", async () => {
    await expect(tasklabService.createTask("", { title: "x" })).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });
});

describe("tasklab.service — setStatus / archive / restore", () => {
  it("moves a task between statuses", async () => {
    const t = await tasklabService.createTask(USER, { title: "Plan" });
    const updated = await tasklabService.setStatus(USER, t.id, "in_progress");
    expect(updated.status).toBe("in_progress");
  });

  it("rejects an unknown status", async () => {
    const t = await tasklabService.createTask(USER, { title: "Plan" });
    await expect(tasklabService.setStatus(USER, t.id, "nope")).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });

  it("404s for a missing task", async () => {
    await expect(tasklabService.setStatus(USER, "task-999", "done")).rejects.toMatchObject({
      type: "NOT_FOUND",
    });
  });

  it("archives then restores a task", async () => {
    const t = await tasklabService.createTask(USER, { title: "Archive me" });
    const archived = await tasklabService.archive(USER, t.id);
    expect(archived.archived).toBe(true);
    const restored = await tasklabService.restore(USER, t.id);
    expect(restored.archived).toBe(false);
  });

  it("rejects archiving an already-archived task", async () => {
    const t = await tasklabService.createTask(USER, { title: "x" });
    await tasklabService.archive(USER, t.id);
    await expect(tasklabService.archive(USER, t.id)).rejects.toMatchObject({ type: "FAILED_PRECONDITION" });
  });

  it("rejects restoring a non-archived task", async () => {
    const t = await tasklabService.createTask(USER, { title: "x" });
    await expect(tasklabService.restore(USER, t.id)).rejects.toMatchObject({ type: "FAILED_PRECONDITION" });
  });
});

describe("tasklab.service — listTasks filtering & search", () => {
  async function seed() {
    const a = await tasklabService.createTask(USER, { title: "Fix the tractor", content: "engine trouble" });
    const b = await tasklabService.createTask(USER, { title: "Order seeds", content: "tomato and carrot" });
    const c = await tasklabService.createTask(USER, { title: "Repair fence" });
    await tasklabService.setStatus(USER, b.id, "done");
    await tasklabService.archive(USER, c.id);
    return { a, b, c };
  }

  it("excludes archived tasks by default and reports counts", async () => {
    await seed();
    const res = await tasklabService.listTasks(USER, {});
    expect(res.total).toBe(2);
    expect(res.active_count).toBe(2);
    expect(res.archived_count).toBe(1);
    expect(res.tasks.every((t) => !t.archived)).toBe(true);
  });

  it("includes archived tasks when asked", async () => {
    await seed();
    const res = await tasklabService.listTasks(USER, { includeArchived: true });
    expect(res.total).toBe(3);
  });

  it("filters by status", async () => {
    await seed();
    const res = await tasklabService.listTasks(USER, { status: "done" });
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].title).toBe("Order seeds");
  });

  it("rejects an unknown status filter", async () => {
    await expect(tasklabService.listTasks(USER, { status: "bogus" })).rejects.toMatchObject({
      type: "INVALID_ARGUMENT",
    });
  });

  it("searches title and content case-insensitively", async () => {
    await seed();
    const byTitle = await tasklabService.listTasks(USER, { query: "tractor" });
    expect(byTitle.tasks.map((t) => t.title)).toContain("Fix the tractor");

    const byContent = await tasklabService.listTasks(USER, { query: "ENGINE" });
    expect(byContent.tasks.map((t) => t.title)).toContain("Fix the tractor");
  });

  it("isolates tasks per user", async () => {
    await tasklabService.createTask(USER, { title: "mine" });
    const other = await tasklabService.listTasks(OTHER, {});
    expect(other.total).toBe(0);
  });
});
