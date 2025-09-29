const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const ResourceController = require("../../controllers/resource.controller");

const fieldsRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const controller = new ResourceController("fields");

fieldsRoute.get(
  "/fields",
  apiLimiter,
  authenticateUser,
  controller.list.bind(controller),
);
fieldsRoute.post(
  "/fields",
  apiLimiter,
  authenticateUser,
  controller.create.bind(controller),
);
fieldsRoute.delete(
  "/fields/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.delete.bind(controller),
);
fieldsRoute.post(
  "/fields/assign",
  apiLimiter,
  authenticateUser,
  controller.assign.bind(controller),
);
fieldsRoute.get(
  "/fields/assign",
  apiLimiter,
  authenticateUser,
  controller.listAssignments.bind(controller),
);
fieldsRoute.delete(
  "/fields/assign/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.removeAssignment.bind(controller),
);
fieldsRoute.put(
  "/fields/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.update.bind(controller),
);
fieldsRoute.post(
  "/fields/districts",
  apiLimiter,
  authenticateUser,
  controller.listDistricts.bind(controller),
);
fieldsRoute.post(
  "/fields/districts/:id",
  apiLimiter,
  authenticateUser,
  controller.listDistricts.bind(controller),
);

module.exports = fieldsRoute;
