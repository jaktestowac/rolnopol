const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const taskManagerController = require("../../controllers/task-manager.controller");

const tasksRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const taskManagerGate = requireFeatureFlag("taskManagerEnabled", { resourceName: "Task manager" });

tasksRoute.use("/tasks", apiLimiter, taskManagerGate, authenticateSessionUser);

tasksRoute.get("/tasks/labels", taskManagerController.listLabels.bind(taskManagerController));
tasksRoute.post("/tasks/labels", taskManagerController.createLabel.bind(taskManagerController));
tasksRoute.put("/tasks/labels/:labelId", taskManagerController.updateLabel.bind(taskManagerController));
tasksRoute.delete("/tasks/labels/:labelId", taskManagerController.deleteLabel.bind(taskManagerController));

tasksRoute.get("/tasks/statuses", taskManagerController.listStatuses.bind(taskManagerController));
tasksRoute.post("/tasks/statuses", taskManagerController.createStatus.bind(taskManagerController));
tasksRoute.patch("/tasks/statuses/reorder", taskManagerController.reorderStatuses.bind(taskManagerController));
tasksRoute.put("/tasks/statuses/:statusId", taskManagerController.updateStatus.bind(taskManagerController));
tasksRoute.post("/tasks/statuses/:statusId/archive", taskManagerController.archiveStatus.bind(taskManagerController));

tasksRoute.get("/tasks", taskManagerController.listTasks.bind(taskManagerController));
tasksRoute.post("/tasks", taskManagerController.createTask.bind(taskManagerController));
tasksRoute.get("/tasks/:taskId", taskManagerController.getTask.bind(taskManagerController));
tasksRoute.put("/tasks/:taskId", taskManagerController.replaceTask.bind(taskManagerController));
tasksRoute.patch("/tasks/:taskId", taskManagerController.patchTask.bind(taskManagerController));
tasksRoute.patch("/tasks/:taskId/move", taskManagerController.moveTask.bind(taskManagerController));
tasksRoute.post("/tasks/:taskId/archive", taskManagerController.archiveTask.bind(taskManagerController));
tasksRoute.post("/tasks/:taskId/restore", taskManagerController.restoreTask.bind(taskManagerController));
tasksRoute.delete("/tasks/:taskId", taskManagerController.deleteTask.bind(taskManagerController));

module.exports = tasksRoute;
