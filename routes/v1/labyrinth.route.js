const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const labyrinthController = require("../../controllers/labyrinth.controller");

const labyrinthRoute = express.Router();
const apiLimiter = createRateLimiter("high");

labyrinthRoute.get("/labyrinth", apiLimiter, labyrinthController.getLabyrinth.bind(labyrinthController));
labyrinthRoute.get("/labyrinth/updates", apiLimiter, labyrinthController.getLabyrinthUpdates.bind(labyrinthController));
labyrinthRoute.post("/labyrinth/actions", apiLimiter, labyrinthController.applyLabyrinthAction.bind(labyrinthController));

module.exports = labyrinthRoute;
