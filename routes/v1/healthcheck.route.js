const express = require("express");
const router = express.Router();
const dbManager = require("../../data/database-manager");
const { sendSuccess, sendError } = require("../../helpers/response-helper");
const logger = require("../../helpers/logger-api");

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Get system health status
 *     description: Returns comprehensive health information including database status
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Health check successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                 databases:
 *                   type: object
 *                   description: Database health information
 *                 memory:
 *                   type: object
 *                   description: Memory usage statistics
 */
// Main healthcheck endpoint (now at /healthcheck)
router.get("/healthcheck", async (req, res) => {
  try {
    const healthData = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      // databases: dbManager.getHealthStats(),
      memory: dbManager.getMemoryStats(),
    };

    // Validate all databases
    const dbValidation = await dbManager.validateAll();
    healthData.databaseValidation = dbValidation;

    // Check if any databases have errors
    const hasErrors = Object.values(dbValidation).some(
      (result) => result.status === "error",
    );
    if (hasErrors) {
      healthData.status = "degraded";
    }

    return sendSuccess(req, res, healthData);
  } catch (error) {
    logger.logError("Health check failed:", error);
    return sendError(req, res, 500, "Health check failed");
  }
});

// Keep the old root endpoint for backward compatibility
router.get("/", async (req, res) => {
  try {
    const healthData = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      // databases: dbManager.getHealthStats(),
      memory: dbManager.getMemoryStats(),
    };

    // Validate all databases
    const dbValidation = await dbManager.validateAll();
    healthData.databaseValidation = dbValidation;

    // Check if any databases have errors
    const hasErrors = Object.values(dbValidation).some(
      (result) => result.status === "error",
    );
    if (hasErrors) {
      healthData.status = "degraded";
    }

    return sendSuccess(req, res, healthData);
  } catch (error) {
    logger.logError("Health check failed:", error);
    return sendError(req, res, 500, "Health check failed");
  }
});

/**
 * @swagger
 * /api/v1/health/databases:
 *   get:
 *     summary: Get database status
 *     description: Returns detailed database status information
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database status retrieved successfully
 */
router.get("/databases", async (req, res) => {
  try {
    const dbStatus = {
      instances: dbManager.getInstanceCount(),
      status: dbManager.getStatus(),
      health: dbManager.getHealthStats(),
      validation: await dbManager.validateAll(),
    };

    return sendSuccess(req, res, dbStatus);
  } catch (error) {
    logger.logError("Database status check failed:", error);
    return sendError(req, res, 500, "Database status check failed");
  }
});

/**
 * @swagger
 * /api/v1/health/memory:
 *   get:
 *     summary: Get memory usage statistics
 *     description: Returns memory usage information
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Memory stats retrieved successfully
 */
router.get("/memory", (req, res) => {
  try {
    const memoryStats = dbManager.getMemoryStats();
    return sendSuccess(req, res, memoryStats);
  } catch (error) {
    logger.logError("Memory stats check failed:", error);
    return sendError(req, res, 500, "Memory stats check failed");
  }
});

module.exports = router;
