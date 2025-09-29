const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const ResourceController = require("../../controllers/resource.controller");

const animalsRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const controller = new ResourceController("animals");

animalsRoute.get(
  "/animals",
  apiLimiter,
  authenticateUser,
  controller.listAnimals.bind(controller),
);
animalsRoute.post(
  "/animals",
  apiLimiter,
  authenticateUser,
  controller.createAnimal.bind(controller),
);
animalsRoute.delete(
  "/animals/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.deleteAnimal.bind(controller),
);
animalsRoute.put(
  "/animals/:id",
  apiLimiter,
  authenticateUser,
  validateIdParam("id"),
  controller.updateAnimal.bind(controller),
);
animalsRoute.get("/animals/types", controller.constructor.getAnimalTypes);

module.exports = animalsRoute;
