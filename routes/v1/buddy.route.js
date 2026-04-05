const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const buddyController = require("../../controllers/buddy.controller");

const buddyRoute = express.Router();
const apiLimiter = createRateLimiter("api");

/**
 * Pet Buddy API Routes
 */

// POST /api/v1/buddy - Hatch a new pet
buddyRoute.post("/buddy", apiLimiter, authenticateUser, buddyController.hatchPet.bind(buddyController));

// GET /api/v1/buddy - Get current user's pet
buddyRoute.get("/buddy", apiLimiter, authenticateUser, buddyController.getPet.bind(buddyController));

// GET /api/v1/buddy/:id - Get pet by ID
buddyRoute.get("/buddy/:id", apiLimiter, authenticateUser, buddyController.getPetById.bind(buddyController));

// DELETE /api/v1/buddy/:id - Release pet
buddyRoute.delete("/buddy/:id", apiLimiter, authenticateUser, buddyController.releasePet.bind(buddyController));

// PATCH /api/v1/buddy/:id - Update customization (eyes, hat)
buddyRoute.patch("/buddy/:id", apiLimiter, authenticateUser, buddyController.updateCustomization.bind(buddyController));

// POST /api/v1/buddy/:id/pet - Pet interaction
buddyRoute.post("/buddy/:id/pet", apiLimiter, authenticateUser, buddyController.petPet.bind(buddyController));

// POST /api/v1/buddy/:id/talk - Talk interaction
buddyRoute.post("/buddy/:id/talk", apiLimiter, authenticateUser, buddyController.talkToPet.bind(buddyController));

// POST /api/v1/buddy/:id/ask-help - Ask for help interaction
buddyRoute.post("/buddy/:id/ask-help", apiLimiter, authenticateUser, buddyController.askForHelp.bind(buddyController));

module.exports = buddyRoute;
