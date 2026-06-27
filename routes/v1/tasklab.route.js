/**
 * TaskLab REST companion routes.
 *
 * Thin proxy: feature-flag gate → session auth (logged-in users only) → gRPC
 * client → JSON. The app never touches TaskLab data directly; it calls the
 * standalone TaskLab service over gRPC. gRPC status codes are mapped to HTTP.
 *
 * Mounted under /api/v1 (see routes/v1/index.js):
 *   GET    /tasklab/statuses
 *   GET    /tasklab/tasks            ?status=&q=&includeArchived=
 *   POST   /tasklab/tasks            body: { title, content }
 *   PATCH  /tasklab/tasks/:id/status body: { status }
 *   POST   /tasklab/tasks/:id/archive
 *   POST   /tasklab/tasks/:id/restore
 */
const express = require("express");
const grpc = require("@grpc/grpc-js");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { client: tasklabClient } = require("../../modules/tasklab");

const router = express.Router();
const apiLimiter = createRateLimiter("api");

// Flag gate → rate limit → session auth (sets req.user.userId). Logged-in only.
router.use(
  "/tasklab",
  requireFeatureFlag("taskLabEnabled", { resourceName: "TaskLab" }),
  apiLimiter,
  authenticateSessionUser,
);

function sendGrpcError(res, err) {
  switch (err?.code) {
    case grpc.status.NOT_FOUND:
      return res.status(404).json(formatResponseBody({ error: err.details || "Not found" }));
    case grpc.status.INVALID_ARGUMENT:
      return res.status(400).json(formatResponseBody({ error: err.details || "Invalid argument" }));
    case grpc.status.FAILED_PRECONDITION:
      return res.status(409).json(formatResponseBody({ error: err.details || "Action not allowed in current state" }));
    case grpc.status.UNAVAILABLE:
    case grpc.status.DEADLINE_EXCEEDED:
      return res.status(503).json(formatResponseBody({ error: "TaskLab service offline — run `npm run tasklab`" }));
    default:
      return res.status(500).json(formatResponseBody({ error: "Internal error" }));
  }
}

const userOf = (req) => req.user?.userId;

router.get("/tasklab/statuses", async (req, res) => {
  try {
    const data = await tasklabClient.listStatuses(userOf(req));
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.get("/tasklab/tasks", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
    const data = await tasklabClient.listTasks(userOf(req), {
      status: req.query.status,
      query: req.query.q,
      includeArchived,
    });
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/tasklab/tasks", async (req, res) => {
  try {
    const data = await tasklabClient.createTask(userOf(req), {
      title: req.body?.title,
      content: req.body?.content,
    });
    return res.status(201).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.patch("/tasklab/tasks/:id/status", async (req, res) => {
  try {
    const data = await tasklabClient.setStatus(userOf(req), req.params.id, req.body?.status);
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/tasklab/tasks/:id/archive", async (req, res) => {
  try {
    const data = await tasklabClient.archive(userOf(req), req.params.id);
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

router.post("/tasklab/tasks/:id/restore", async (req, res) => {
  try {
    const data = await tasklabClient.restore(userOf(req), req.params.id);
    return res.status(200).json(formatResponseBody({ data }));
  } catch (err) {
    return sendGrpcError(res, err);
  }
});

module.exports = router;
