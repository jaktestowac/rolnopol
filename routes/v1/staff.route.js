const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const ResourceController = require("../../controllers/resource.controller");

const staffRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const controller = new ResourceController("staff");

staffRoute.get(
  "/staff",
  apiLimiter,
  authenticateUser,
  controller.list.bind(controller),
);
staffRoute.post(
  "/staff",
  apiLimiter,
  authenticateUser,
  controller.create.bind(controller),
);
staffRoute.delete(
  "/staff/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.delete.bind(controller),
);
staffRoute.put(
  "/staff/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.update.bind(controller),
);

module.exports = staffRoute;
