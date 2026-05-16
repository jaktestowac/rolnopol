import { beforeEach, describe, expect, it, vi } from "vitest";

const TASKS_PAGE_PATH = "../../public/js/pages/tasks.js";

function loadTasksPageModule() {
  delete require.cache[require.resolve(TASKS_PAGE_PATH)];
  require(TASKS_PAGE_PATH);
}

describe("TasksPage assignee and delete behavior", () => {
  beforeEach(() => {
    global.window = {
      showConfirmationModal: vi.fn(async () => true),
      showNotification: vi.fn(),
      confirm: vi.fn(() => true),
    };

    global.document = {
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ textContent: "", innerHTML: "" })),
    };

    loadTasksPageModule();
  });

  it("includes the current user as a selectable assignee", () => {
    const page = new window.TasksPage();
    const fillSelect = vi.fn();

    page.state.currentUser = { userId: 42, displayedName: "Alex Farmer" };
    page.state.staff = [
      { id: 42, name: "Alex", surname: "Farmer" },
      { id: 7, name: "Casey", surname: "Field" },
    ];
    page._fillSelect = fillSelect;

    page._renderTaskFormOptions();

    const assigneeOptions = fillSelect.mock.calls[1][1];
    expect(assigneeOptions).toEqual([
      { value: "", label: "Unassigned" },
      { value: "self", label: "Me" },
      { value: "7", label: "Casey Field" },
    ]);
  });

  it("builds a selfAssigned payload when Me is selected", () => {
    const page = new window.TasksPage();

    page.state.currentUser = { userId: 42 };
    page.taskTitleInput = { value: "Inspect irrigation" };
    page.taskDescriptionInput = { value: "Check the south field irrigation line." };
    page.taskStatusInput = { value: "status-1" };
    page.taskDueDateInput = { value: "" };
    page.taskAssigneeInput = { value: "self" };
    page.taskColorInput = { value: "#2F855A" };
    page.taskLabelsInput = { selectedOptions: [] };
    page.taskRecurringEnabledInput = { checked: false };
    page.taskRecurringFrequencyInput = { value: "weekly" };
    page.taskRecurringIntervalInput = { value: 1 };
    page.taskRecurringEndsAtInput = { value: "" };
    page.taskChecklistInput = { value: "" };

    const payload = page._buildTaskPayload();

    expect(payload.selfAssigned).toBe(true);
    expect(payload.assigneeStaffId).toBeNull();
  });

  it("labels self-assigned tasks as Me", () => {
    const page = new window.TasksPage();
    page.state.currentUser = { userId: 42 };
    page.state.staff = [{ id: 7, name: "Casey", surname: "Field" }];

    expect(page._assigneeLabel({ selfAssigned: true, assigneeStaffId: 42 })).toBe("Me");
    expect(page._assigneeLabel({ selfAssigned: false, assigneeStaffId: 7 })).toBe("Casey Field");
  });

  it("asks for confirmation before deleting an archived task from the card actions", async () => {
    const page = new window.TasksPage();
    page.apiService = {
      delete: vi.fn(async () => ({ success: true })),
    };
    page._loadTasks = vi.fn(async () => {});

    const deleteButton = {
      getAttribute: vi.fn((name) => (name === "data-task-delete" ? "task-9" : null)),
    };

    await page._handleTaskAction({
      target: {
        closest: vi.fn(() => deleteButton),
      },
    });

    expect(window.showConfirmationModal).toHaveBeenCalledWith({
      title: "Delete archived task",
      message: "Delete this archived task permanently?",
      confirmText: "Delete",
      cancelText: "Cancel",
    });
    expect(page.apiService.delete).toHaveBeenCalledWith("tasks/task-9", {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    expect(page._loadTasks).toHaveBeenCalledTimes(1);
  });
});
