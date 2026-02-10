const { formatResponseBody } = require("../helpers/response-helper");
const packageJson = require("../package.json");

/**
 * API Version Middleware
 * Handles version routing and provides version information
 */
class VersionMiddleware {
  constructor() {
    this.versions = {
      v1: {
        version: packageJson.version,
        status: "stable",
        deprecated: false,
        sunsetDate: null,
        description: "Initial API version with core functionality",
      },
      v2: {
        version: "2.0.0",
        status: "development",
        deprecated: false,
        sunsetDate: null,
        description: "Enhanced API version with improved features",
      },
    };

    // Bind middleware methods to the instance so they can be used directly
    // as Express middleware without losing the `this` context.
    this.versionRouter = (req, res, next) => {
      // Prefer originalUrl to preserve the full path including mount points
      const pathCandidate = (req.originalUrl || "").split("?")[0];
      const versionMatch = pathCandidate.match(/\/(v\d+)/);

      if (versionMatch) {
        const version = versionMatch[1];

        // Check if version exists
        if (!this.versions[version]) {
          return res.status(400).json(
            formatResponseBody({
              error: `Unsupported API version: ${version}`,
              supportedVersions: Object.keys(this.versions),
              currentVersion: "v1",
            }),
          );
        }

        // Check if version is deprecated
        if (this.isDeprecated(version)) {
          const versionInfo = this.getVersionInfo(version);
          res.set("Warning", `299 - "This API version is deprecated and will be sunset on ${versionInfo.sunsetDate}"`);
        }

        // Add version info to request
        req.apiVersion = version;
        req.versionInfo = this.getVersionInfo(version);
      }

      next();
    };

    this.versionHeaders = (req, res, next) => {
      if (req.apiVersion) {
        const versionInfo = this.getVersionInfo(req.apiVersion);
        res.set({
          "X-API-Version": req.apiVersion,
          "X-API-Version-Number": versionInfo.version,
          "X-API-Status": versionInfo.status,
        });
      }
      next();
    };
  }

  /**
   * Get version information
   * @param {string} version - Version key (v1, v2, etc.)
   * @returns {Object} Version information
   */
  getVersionInfo(version) {
    return this.versions[version] || null;
  }

  /**
   * Get all versions information
   * @returns {Object} All versions information
   */
  getAllVersions() {
    return this.versions;
  }

  /**
   * Check if version is deprecated
   * @param {string} version - Version key
   * @returns {boolean} True if deprecated
   */
  isDeprecated(version) {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo ? versionInfo.deprecated : false;
  }

  /**
   * Middleware to handle version routing
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  versionRouter(req, res, next) {
    const path = req.path;

    // Extract version from path (e.g., /api/v1/users -> v1)
    const versionMatch = path.match(/^\/api\/(v\d+)/);

    if (versionMatch) {
      const version = versionMatch[1];

      // Check if version exists
      if (!this.versions[version]) {
        return res.status(400).json(
          formatResponseBody({
            error: `Unsupported API version: ${version}`,
            supportedVersions: Object.keys(this.versions),
            currentVersion: "v1",
          }),
        );
      }

      // Check if version is deprecated
      if (this.isDeprecated(version)) {
        const versionInfo = this.getVersionInfo(version);
        res.set("Warning", `299 - "This API version is deprecated and will be sunset on ${versionInfo.sunsetDate}"`);
      }

      // Add version info to request
      req.apiVersion = version;
      req.versionInfo = this.getVersionInfo(version);
    }

    next();
  }

  /**
   * Middleware to add version headers
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  versionHeaders(req, res, next) {
    if (req.apiVersion) {
      const versionInfo = this.getVersionInfo(req.apiVersion);
      res.set({
        "X-API-Version": req.apiVersion,
        "X-API-Version-Number": versionInfo.version,
        "X-API-Status": versionInfo.status,
      });
    }
    next();
  }
}

// Create singleton instance
const versionMiddleware = new VersionMiddleware();

module.exports = versionMiddleware;
