const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logInfo } = require("../helpers/logger-api");
const adminService = require("../services/admin.service");
const { getClientId } = require("../middleware/rate-limit.middleware");
const { loginExpirationAdmin } = require("../data/settings");
const fs = require("fs");
const path = require("path");

class AdminController {
  /**
   * Admin login
   */
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const clientId = getClientId(req);

      const result = await adminService.loginAdmin(
        { username, password },
        clientId,
      );

      // Clear any previous failed attempts on successful login
      req.adminLoginAttempts.clear();

      // Set token in cookie for future requests
      res.cookie("krakenToken", result.token, {
        httpOnly: false, // Allow JavaScript access for client-side storage
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict", // CSRF protection
        maxAge: loginExpirationAdmin.hours * 60 * 60 * 1000, // 1 hour
      });

      res.status(200).json(
        formatResponseBody({
          message: "Login successful",
          data: result,
        }),
      );
    } catch (error) {
      // Record failed attempt
      req.adminLoginAttempts.recordFailed();

      const attemptData = req.adminLoginAttempts.getAttempts();
      let errorMessage = error.message;
      let statusCode = 403;

      // Add warning about remaining attempts
      const attemptsLeft = 5 - attemptData.count;
      if (attemptsLeft > 0) {
        errorMessage += `. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining before temporary block.`;
      } else {
        const timeLeft = Math.ceil(
          (attemptData.blockedUntil - Date.now()) / 1000 / 60,
        );
        errorMessage = `Too many failed attempts. Access blocked for ${timeLeft} minute${timeLeft === 1 ? "" : "s"}.`;
        statusCode = 429;
      }

      res.status(statusCode).json(
        formatResponseBody({
          error: errorMessage,
          attemptsRemaining: Math.max(0, attemptsLeft),
        }),
      );
    }
  }

  /**
   * Admin logout
   */
  async logout(req, res) {
    try {
      // Get token from request to revoke it
      const authHeader = req.headers.authorization;
      const tokenFromBody = req.body.token;
      const tokenFromCookie = req.cookies?.krakenToken;

      let token = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      } else if (tokenFromBody) {
        token = tokenFromBody;
      } else if (tokenFromCookie) {
        token = tokenFromCookie;
      }

      await adminService.logoutAdmin(token);

      // Clear the cookie on server side
      res.clearCookie("krakenToken", {
        path: "/",
        sameSite: "strict",
      });

      res.status(200).json(
        formatResponseBody({
          message: "Logout successful",
        }),
      );
    } catch (error) {
      logError("Error during admin logout:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Logout failed",
        }),
      );
    }
  }

  /**
   * Get system statistics
   */
  async getStats(req, res) {
    try {
      const stats = await adminService.getSystemStats();

      res.status(200).json(
        formatResponseBody({
          data: stats,
        }),
      );
    } catch (error) {
      logError("Error getting system stats:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get system statistics",
        }),
      );
    }
  }

  /**
   * Get lightweight overview statistics for the admin dashboard
   */
  async getOverviewStats(req, res) {
    try {
      const stats = await adminService.getOverviewStats();
      res.status(200).json(
        formatResponseBody({
          data: stats,
        }),
      );
    } catch (error) {
      logError("Error getting overview stats:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get overview statistics",
        }),
      );
    }
  }

  /**
   * Get all users
   */
  async getAllUsers(req, res) {
    try {
      const users = await adminService.getAllUsersDetailed();

      res.status(200).json(
        formatResponseBody(
          {
            data: { users },
          },
          true,
        ),
      );
    } catch (error) {
      logError("Error getting all users:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get users",
        }),
      );
    }
  }

  /**
   * Update user status
   */
  async updateUserStatus(req, res) {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      const updatedUser = await adminService.updateUserStatus(userId, isActive);

      res.status(200).json(
        formatResponseBody(
          {
            message: "User status updated successfully",
            data: updatedUser,
          },
          true,
        ),
      );
    } catch (error) {
      logError("Error updating user status:", error);

      let statusCode = 500;
      if (error.message.includes("not found")) statusCode = 404;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Delete user
   */
  async deleteUser(req, res) {
    try {
      const { userId } = req.params;

      const result = await adminService.deleteUser(userId);

      res.status(200).json(
        formatResponseBody({
          message: result.message,
        }),
      );
    } catch (error) {
      logError("Error deleting user:", error);

      let statusCode = 500;
      if (error.message.includes("not found")) statusCode = 404;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Validate admin token
   */
  async validateToken(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json(
          formatResponseBody({
            error: "Token is required",
          }),
        );
      }

      const isValid = await adminService.validateToken(token);

      res.status(200).json(
        formatResponseBody({
          data: { isValid },
        }),
      );
    } catch (error) {
      logError("Error validating admin token:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Token validation failed",
        }),
      );
    }
  }

  /**
   * Get dashboard data
   */
  async getDashboard(req, res) {
    try {
      const dashboardData = await adminService.getDashboardData();

      res.status(200).json(
        formatResponseBody({
          data: dashboardData,
        }),
      );
    } catch (error) {
      logError("Error getting dashboard data:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get dashboard data",
        }),
      );
    }
  }

  /**
   * Get all fields
   */
  async getAllFields(req, res) {
    try {
      const fields = await adminService.getAllFields();

      res.status(200).json(
        formatResponseBody(
          {
            data: { fields },
          },
          true,
        ),
      );
    } catch (error) {
      logError("Error getting all fields:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get fields",
        }),
      );
    }
  }

  /**
   * Get all staff
   */
  async getAllStaff(req, res) {
    try {
      const staff = await adminService.getAllStaff();

      res.status(200).json(
        formatResponseBody(
          {
            data: { staff },
          },
          true,
        ),
      );
    } catch (error) {
      logError("Error getting all staff:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get staff",
        }),
      );
    }
  }

  /**
   * Get all animals
   */
  async getAllAnimals(req, res) {
    try {
      const animals = await adminService.getAllAnimals();

      res.status(200).json(
        formatResponseBody(
          {
            data: { animals },
          },
          true,
        ),
      );
    } catch (error) {
      logError("Error getting all animals:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to get animals",
        }),
      );
    }
  }

  /**
   * Create database backup
   */
  async createBackup(req, res) {
    try {
      const backupData = await adminService.createDatabaseBackup();

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );

      res.status(200).json(backupData);
    } catch (error) {
      logError("Error creating database backup:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to create backup",
        }),
      );
    }
  }

  /**
   * Restore database from backup
   */
  async restoreBackup(req, res) {
    try {
      const backupData = req.body;

      if (!backupData || !backupData.users) {
        return res.status(400).json(
          formatResponseBody({
            error: "Invalid backup data format",
          }),
        );
      }

      const result = await adminService.restoreDatabase(backupData);

      res.status(200).json(
        formatResponseBody({
          message: "Database restored successfully",
          data: result,
        }),
      );
    } catch (error) {
      logError("Error restoring database:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Failed to restore database",
        }),
      );
    }
  }

  /**
   * Reinitialize all database services from current JSON files
   *  /api/v1/admin/database/reinit
   */
  async reinitializeDatabases(req, res) {
    try {
      const dbManager = require("../data/database-manager");
      // Gather counts before
      const before = {};
      for (const [key, db] of dbManager.instances) {
        if (typeof db.getAll === "function") {
          const data = await db.getAll();
          before[key] = Array.isArray(data)
            ? data.length
            : data && typeof data === "object"
              ? Object.keys(data).length
              : 0;
        }
      }
      const { reloadDatabasesFromDisk } = require("../data/database-init");
      await reloadDatabasesFromDisk();
      // Gather counts after
      const after = {};
      for (const [key, db] of dbManager.instances) {
        if (typeof db.getAll === "function") {
          const data = await db.getAll();
          after[key] = Array.isArray(data)
            ? data.length
            : data && typeof data === "object"
              ? Object.keys(data).length
              : 0;
        }
      }
      logInfo("All database services reinitialized from current JSON files.", {
        before,
        after,
      });
      res.status(200).json(
        formatResponseBody({
          message:
            "All database services reinitialized from current JSON files.",
          data: { before, after },
        }),
      );
    } catch (error) {
      logError("Error reinitializing databases:", error);
      res.status(500).json(
        formatResponseBody({
          error: error.message || "Failed to reinitialize databases.",
        }),
      );
    }
  }
}

/**
 * Serve documentation data as JSON
 */
async function getDocumentation(req, res) {
  try {
    const docsPath = path.join(__dirname, "../data/docs.json");
    const docsData = fs.readFileSync(docsPath, "utf-8");
    const docs = JSON.parse(docsData);
    res.status(200).json({ success: true, docs });
  } catch (error) {
    logError("Error reading documentation data:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to load documentation data" });
  }
}

module.exports = new AdminController();
module.exports.getDocumentation = getDocumentation;
