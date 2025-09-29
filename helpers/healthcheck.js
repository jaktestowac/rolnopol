const dbManager = require("../data/database-manager");
const { logInfo, logError } = require("./logger-api");
const fs = require("fs");
const path = require("path");

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function pad(str, len, align = "left") {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  const padLen = len - str.length;
  if (align === "right") return " ".repeat(padLen) + str;
  return str + " ".repeat(padLen);
}

async function performStartupHealthCheck() {
  try {
    const packageJson = require("../package.json");
    const health = {
      status: "healthy",
      uptime: process.uptime(),
      memory: dbManager.getMemoryStats(),
      version: packageJson.version,
    };
    // Check for presence of project marker file `rolno.d` in repository root
    const rolno = checkRolnoFileExists();
    health.rolno = rolno;
    const dbValidation = await dbManager.validateAll();
    health.databaseValidation = dbValidation;
    const failing = Object.entries(dbValidation).filter(([_, v]) => v.status === "error");
    if (failing.length > 0) {
      health.status = "degraded";
    }

    // --- Readable Output ---
    const lines = [];
    lines.push("\n================ Application Health Check ================");
    lines.push(`Status   : ${health.status.toUpperCase()}`);
    lines.push(`Version  : ${health.version}`);
    lines.push(`Uptime   : ${formatUptime(health.uptime)}`);
    lines.push(`Marker   : ${health.rolno.exists ? `FOUND (${health.rolno.filePath})` : "NOT FOUND"}`);
    const mem = health.memory.memoryUsage;
    lines.push(
      `Memory   : Heap Used ${formatBytes(mem.heapUsed)} / Heap Total ${formatBytes(mem.heapTotal)} | RSS ${formatBytes(mem.rss)}`
    );
    lines.push("\nDatabases:");
    // Table header
    lines.push(pad("DB Name", 24) + " | " + pad("Status", 8) + " | " + pad("Size", 10, "right") + " | " + pad("Entities", 8, "right"));
    lines.push("-".repeat(24) + "-|-" + "-".repeat(8) + "-|-" + "-".repeat(10) + "-|-" + "-".repeat(8));
    // Get file paths for each DB
    const dbStatus = dbManager.getStatus();
    const dbInstances = dbManager.instances;
    for (const [db, result] of Object.entries(dbValidation)) {
      let sizeStr = "N/A";
      let entityCount = "?";
      const filePath = dbStatus[db] && dbStatus[db].filePath;
      if (filePath && fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          sizeStr = formatBytes(stats.size);
        } catch (e) {
          sizeStr = "ERR";
        }
      }
      const dbInstance = dbInstances.get(db);
      if (dbInstance && dbInstance.data !== null && dbInstance.data !== undefined) {
        if (Array.isArray(dbInstance.data)) {
          entityCount = dbInstance.data.length;
        } else if (typeof dbInstance.data === "object") {
          entityCount = Object.keys(dbInstance.data).length;
        } else {
          entityCount = 0;
        }
      }
      let statusStr = result.status === "ok" ? "OK" : "ERROR";
      if (result.status !== "ok" && result.error) statusStr += ": " + result.error;
      lines.push(pad(db, 24) + " | " + pad(statusStr, 8) + " | " + pad(sizeStr, 10, "right") + " | " + pad(entityCount, 8, "right"));
    }
    lines.push("========================================================\n");
    if (health.status === "degraded") {
      logError(lines.join("\n"));
    } else {
      logInfo(lines.join("\n"));
    }
    return health;
  } catch (err) {
    logError("Health check failed on startup", err);
    throw err;
  }
}

// Utility to check if project root contains the marker file `rolno.d`
function checkRolnoFileExists() {
  const projectRoot = path.resolve(__dirname, "..");
  const filePath = path.join(projectRoot, "rolno.d");
  let exists = false;
  try {
    exists = fs.existsSync(filePath);
  } catch (_e) {
    exists = false;
  }

  // read file content:
  let content = "";
  if (exists) {
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (_e) {
      content = "";
    }
  }

  return { exists, filePath, content };
}

module.exports = { performStartupHealthCheck, checkRolnoFileExists };
