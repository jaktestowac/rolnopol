const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const taskManagerService = require("../services/task-manager.service");

class TaskManagerController {
  async listTasks(req, res) {
    try {
      const data = await taskManagerService.listTasks(req.user.userId, req.query || {});
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      return this._handleError("Error listing tasks", error, res);
    }
  }

  async getTask(req, res) {
    try {
      const task = await taskManagerService.getTask(req.user.userId, req.params.taskId);
      return res.status(200).json(formatResponseBody({ data: { task } }));
    } catch (error) {
      return this._handleError("Error getting task", error, res);
    }
  }

  async createTask(req, res) {
    try {
      const task = await taskManagerService.createTask(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Task created successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error creating task", error, res);
    }
  }

  async replaceTask(req, res) {
    try {
      const task = await taskManagerService.replaceTask(req.user.userId, req.params.taskId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Task updated successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error replacing task", error, res);
    }
  }

  async patchTask(req, res) {
    try {
      const task = await taskManagerService.patchTask(req.user.userId, req.params.taskId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Task updated successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error patching task", error, res);
    }
  }

  async moveTask(req, res) {
    try {
      const task = await taskManagerService.moveTask(req.user.userId, req.params.taskId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Task moved successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error moving task", error, res);
    }
  }

  async archiveTask(req, res) {
    try {
      const task = await taskManagerService.archiveTask(req.user.userId, req.params.taskId);
      return res.status(200).json(
        formatResponseBody({
          message: "Task archived successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error archiving task", error, res);
    }
  }

  async restoreTask(req, res) {
    try {
      const task = await taskManagerService.restoreTask(req.user.userId, req.params.taskId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Task restored successfully",
          data: { task },
        }),
      );
    } catch (error) {
      return this._handleError("Error restoring task", error, res);
    }
  }

  async deleteTask(req, res) {
    try {
      const data = await taskManagerService.deleteTask(req.user.userId, req.params.taskId);
      return res.status(200).json(
        formatResponseBody({
          message: "Task deleted successfully",
          data,
        }),
      );
    } catch (error) {
      return this._handleError("Error deleting task", error, res);
    }
  }

  async listLabels(req, res) {
    try {
      const data = await taskManagerService.listLabels(req.user.userId);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      return this._handleError("Error listing task labels", error, res);
    }
  }

  async createLabel(req, res) {
    try {
      const label = await taskManagerService.createLabel(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Label created successfully",
          data: { label },
        }),
      );
    } catch (error) {
      return this._handleError("Error creating task label", error, res);
    }
  }

  async updateLabel(req, res) {
    try {
      const label = await taskManagerService.updateLabel(req.user.userId, req.params.labelId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Label updated successfully",
          data: { label },
        }),
      );
    } catch (error) {
      return this._handleError("Error updating task label", error, res);
    }
  }

  async deleteLabel(req, res) {
    try {
      const data = await taskManagerService.deleteLabel(req.user.userId, req.params.labelId);
      return res.status(200).json(
        formatResponseBody({
          message: "Label deleted successfully",
          data,
        }),
      );
    } catch (error) {
      return this._handleError("Error deleting task label", error, res);
    }
  }

  async listStatuses(req, res) {
    try {
      const data = await taskManagerService.listStatuses(req.user.userId);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      return this._handleError("Error listing task statuses", error, res);
    }
  }

  async createStatus(req, res) {
    try {
      const status = await taskManagerService.createStatus(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Status created successfully",
          data: { status },
        }),
      );
    } catch (error) {
      return this._handleError("Error creating task status", error, res);
    }
  }

  async updateStatus(req, res) {
    try {
      const status = await taskManagerService.updateStatus(req.user.userId, req.params.statusId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Status updated successfully",
          data: { status },
        }),
      );
    } catch (error) {
      return this._handleError("Error updating task status", error, res);
    }
  }

  async reorderStatuses(req, res) {
    try {
      const statuses = await taskManagerService.reorderStatuses(req.user.userId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Statuses reordered successfully",
          data: { statuses },
        }),
      );
    } catch (error) {
      return this._handleError("Error reordering task statuses", error, res);
    }
  }

  async archiveStatus(req, res) {
    try {
      const status = await taskManagerService.archiveStatus(req.user.userId, req.params.statusId);
      return res.status(200).json(
        formatResponseBody({
          message: "Status archived successfully",
          data: { status },
        }),
      );
    } catch (error) {
      return this._handleError("Error archiving task status", error, res);
    }
  }

  _handleError(message, error, res) {
    logError(message, error);
    const errorMessage = typeof error?.message === "string" ? error.message : "Internal server error";
    let statusCode = 500;

    if (errorMessage.includes("Validation failed")) {
      statusCode = 400;
    } else if (errorMessage.includes("not found")) {
      statusCode = 404;
    } else if (errorMessage.includes("Invalid user id")) {
      statusCode = 401;
    }

    return res.status(statusCode).json(
      formatResponseBody({
        error: errorMessage,
      }),
    );
  }
}

module.exports = new TaskManagerController();
