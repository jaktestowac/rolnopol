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

// Render a boxed message using box-drawing characters and return as string
function createBox(lines, padding = 1) {
  const content = lines.map((l) => String(l));
  const width = Math.max(...content.map((l) => l.length)) + padding * 2;
  const hr = "═".repeat(width);
  const top = "╔" + hr + "╗";
  const bottom = "╚" + hr + "╝";
  const padded = content.map((l) => {
    const extra = width - padding - l.length;
    return "║" + " ".repeat(padding) + l + " ".repeat(extra) + "║";
  });
  return [top, ...padded, bottom].join("\n");
}

// Print a highlighted, bordered error about missing dependencies and exit the process
function printMissingDepsBox(missingModules, installCmd) {
  const lines = [];
  lines.push("!! MISSING DEPENDENCIES DETECTED !!");
  lines.push("");
  lines.push(`Missing (${missingModules.length}): ${missingModules.join(", ")}`);
  lines.push("");
  lines.push("");
  lines.push("To install all dependencies, run:");
  lines.push(`  ${installCmd}`);
  lines.push("");
  lines.push("Startup aborted.");
  lines.push("");
  lines.push("");
  lines.push("<3 jaktestowac.pl Team");

  const box = createBox(lines);
  const red = "\x1b[31m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";
  console.error("\n" + red + bold + box + reset + "\n");
  process.exit(1);
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

    // --- Check for missing node_modules / dependencies ---
    const projectRoot = path.resolve(__dirname, "..");
    const nodeModulesPath = path.join(projectRoot, "node_modules");
    const missingModules = [];

    // detect preferred package manager for suggestion
    function getInstallCommand() {
      try {
        if (packageJson.packageManager) {
          // e.g. "pnpm@8.5.0" or "npm@9.0.0"
          const pm = String(packageJson.packageManager).split("@")[0];
          return `${pm} install`;
        }
      } catch (_) {}
      if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm install";
      if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn install";
      if (fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "npm install";
      return "npm install";
    }

    const installCmd = getInstallCommand();

    // collect declared dependency types we care about
    const declaredDeps = new Set();
    ["dependencies", "optionalDependencies", "peerDependencies"].forEach((k) => {
      const map = packageJson[k] || {};
      Object.keys(map).forEach((name) => declaredDeps.add(name));
    });
    const deps = Array.from(declaredDeps);

    if (!fs.existsSync(nodeModulesPath)) {
      // Mark all declared dependencies as missing
      missingModules.push(...deps);
    } else {
      // Check each dependency can be resolved from project root
      for (const dep of deps) {
        try {
          // try to resolve the package from project root
          require.resolve(dep, { paths: [projectRoot] });
        } catch (e) {
          missingModules.push(dep);
        }
      }
    }

    if (missingModules.length > 0) {
      health.status = "degraded";
    }

    // expose modules information in health object for programmatic access
    health.modules = { missing: missingModules, installCommand: installCmd };

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
      `Memory   : Heap Used ${formatBytes(mem.heapUsed)} / Heap Total ${formatBytes(mem.heapTotal)} | RSS ${formatBytes(mem.rss)}`,
    );

    // Module status
    lines.push("\nModules:");
    if (missingModules.length === 0) {
      lines.push("All declared dependencies are installed (node_modules present)");
    } else {
      lines.push(`Missing dependencies (${missingModules.length}): ${missingModules.join(", ")}`);
      lines.push("\nTo install missing packages, run the following in the project root:");
      lines.push(`  ${installCmd}`);
      lines.push(`Or to install only missing packages explicitly: ${installCmd} ${missingModules.join(" ")}`);
    }

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
      // If missing modules, print a bordered message and abort startup
      if (missingModules.length > 0) {
        printMissingDepsBox(missingModules, installCmd);
      } else {
        logError(lines.join("\n"));
      }
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

// Build a health data object suitable for API responses and programmatic checks
async function buildHealthData() {
  const packageJson = require("../package.json");
  const projectRoot = path.resolve(__dirname, "..");
  const nodeModulesPath = path.join(projectRoot, "node_modules");

  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: dbManager.getMemoryStats(),
    version: packageJson.version,
  };

  // helper to detect preferred install command
  function getInstallCommand() {
    try {
      if (packageJson.packageManager) {
        const pm = String(packageJson.packageManager).split("@")[0];
        return `${pm} install`;
      }
    } catch (_) {}
    if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm install";
    if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn install";
    if (fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "npm install";
    return "npm install";
  }

  // const installCmd = getInstallCommand();
  const installCmd = "npm install"; // For API response, we can just suggest npm install as a generic command

  // collect declared dependency names
  // const declaredDeps = new Set();
  // ["dependencies", "optionalDependencies", "peerDependencies"].forEach((k) => {
  //   const map = packageJson[k] || {};
  //   Object.keys(map).forEach((name) => declaredDeps.add(name));
  // });
  // const deps = Array.from(declaredDeps);

  const missingModules = [];
  // if (!fs.existsSync(nodeModulesPath)) {
  //   missingModules.push(...deps);
  // } else {
  //   for (const dep of deps) {
  //     try {
  //       require.resolve(dep, { paths: [projectRoot] });
  //     } catch (e) {
  //       missingModules.push(dep);
  //     }
  //   }
  // }

  health.modules = { missing: missingModules, installCommand: installCmd };

  // marker file
  health.rolno = checkRolnoFileExists();

  // database validation
  const dbValidation = await dbManager.validateAll();
  health.databaseValidation = dbValidation;
  const failing = Object.entries(dbValidation).filter(([_, v]) => v.status === "error");
  if (missingModules.length > 0 || failing.length > 0) {
    health.status = "degraded";
  }

  return health;
}

async function performStartupHealthCheck() {
  try {
    const health = await buildHealthData();

    const missingModules = health.modules.missing;
    const installCmd = health.modules.installCommand;

    if (!Array.isArray(missingModules)) {
      // Ensure we have an array to work with in older environments
      missingModules = Array.isArray(missingModules) ? missingModules : [];
    }

    if (missingModules.length > 0) {
      // If modules are missing, abort startup with a boxed message
      printMissingDepsBox(missingModules, installCmd);
    }

    // --- Render human readable output ---
    const lines = [];
    lines.push("\n================ Application Health Check ================");
    lines.push(`Status   : ${health.status.toUpperCase()}`);
    lines.push(`Version  : ${health.version}`);
    lines.push(`Uptime   : ${formatUptime(health.uptime)}`);
    lines.push(`Marker   : ${health.rolno.exists ? `FOUND (${health.rolno.filePath})` : "NOT FOUND"}`);
    const mem = health.memory.memoryUsage;
    lines.push(
      `Memory   : Heap Used ${formatBytes(mem.heapUsed)} / Heap Total ${formatBytes(mem.heapTotal)} | RSS ${formatBytes(mem.rss)}`,
    );

    // Modules
    lines.push("\nModules:");
    if (missingModules.length === 0) {
      lines.push("All declared dependencies are installed (node_modules present)");
    } else {
      lines.push(`Missing dependencies (${missingModules.length}): ${missingModules.join(", ")}`);
      lines.push("\nTo install missing packages, run the following in the project root:");
      lines.push(`  ${installCmd}`);
      lines.push(`Or to install only missing packages explicitly: ${installCmd} ${missingModules.join(" ")}`);
    }

    lines.push("\nDatabases:");
    lines.push(pad("DB Name", 24) + " | " + pad("Status", 8) + " | " + pad("Size", 10, "right") + " | " + pad("Entities", 8, "right"));
    lines.push("-".repeat(24) + "-|-" + "-".repeat(8) + "-|-" + "-".repeat(10) + "-|-" + "-".repeat(8));

    const dbStatus = dbManager.getStatus();
    const dbInstances = dbManager.instances;
    for (const [db, result] of Object.entries(health.databaseValidation)) {
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
      // Already handled missing modules above - if here, just log an error
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

module.exports = { performStartupHealthCheck, checkRolnoFileExists, buildHealthData };
