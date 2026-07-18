/**
 * Service launcher — spawns and stops the app's standalone external services as
 * tracked child processes, so operators can start them straight from the Kraken
 * "External Services" tab instead of dropping to a terminal.
 *
 * This is a LOCAL / DEV convenience: it runs a fixed allowlist of known service
 * entrypoints (never an arbitrary command) and is admin-gated + disabled in
 * production at the route layer. Health is still probed independently by
 * service-monitor.service — this module only owns the processes IT spawned.
 *
 * Each launcher spawns `node <entry>` exactly like the FarmStay supervisor does
 * (external-services/farm-stay/start-all.js). Farm Stay's entry is that same
 * supervisor, which fans out to its five leaves and forwards termination.
 */
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { logError, logInfo, logDebug } = require("../helpers/logger-api");

const REPO_ROOT = path.join(__dirname, "..");
const MAX_LOG_LINES = 60;
const STOP_TIMEOUT_MS = 5000;
const IS_WINDOWS = process.platform === "win32";

// Allowlist. Keys match service-monitor.service SERVICES keys so the UI can pair
// each launcher with its health card.
const LAUNCHERS = {
  greenhouse: {
    name: "Greenhouse",
    entry: path.join(REPO_ROOT, "external-services", "greenhouse", "greenhouse-server", "index.js"),
    startCommand: "npm run greenhouse",
  },
  tasklab: {
    name: "TaskLab",
    entry: path.join(REPO_ROOT, "external-services", "tasklab", "tasklab-server", "index.js"),
    startCommand: "npm run tasklab",
  },
  "farm-stay": {
    name: "Farm Stay",
    entry: path.join(REPO_ROOT, "external-services", "farm-stay", "start-all.js"),
    startCommand: "npm run farmstay",
    multiProcess: true,
  },
};

// key → { child, pid, startedAt, status, exitCode, exitSignal, error, logs[] }
const managed = new Map();

function isManageable(key) {
  return Object.prototype.hasOwnProperty.call(LAUNCHERS, key);
}

function appendLog(rec, stream, line) {
  if (!line || !line.trim()) return;
  rec.logs.push({ at: new Date().toISOString(), stream, line });
  if (rec.logs.length > MAX_LOG_LINES) rec.logs.shift();
}

function pipe(rec, stream, streamName) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) appendLog(rec, streamName, l);
  });
}

/**
 * Spawn a service if it isn't already running under our management. Returns a
 * summary; never throws for the "already running" case.
 */
function start(key) {
  const def = LAUNCHERS[key];
  if (!def) {
    const err = new Error(`Unknown service: ${key}`);
    err.statusCode = 404;
    throw err;
  }

  const existing = managed.get(key);
  if (existing && existing.status === "running" && existing.child) {
    return { key, alreadyRunning: true, pid: existing.pid, startedAt: existing.startedAt };
  }

  const child = spawn(process.execPath, [def.entry], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group on POSIX so we can tree-kill the leaves; on Windows we
    // tree-kill via taskkill /T instead.
    detached: !IS_WINDOWS,
    windowsHide: true,
  });

  const rec = {
    child,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    exitSignal: null,
    error: null,
    logs: [],
  };
  managed.set(key, rec);

  pipe(rec, child.stdout, "stdout");
  pipe(rec, child.stderr, "stderr");

  child.on("error", (err) => {
    rec.status = "exited";
    rec.error = err.message;
    rec.child = null;
    appendLog(rec, "stderr", `spawn error: ${err.message}`);
    logError(`Service launcher: ${key} spawn error`, err);
  });

  child.on("exit", (code, signal) => {
    rec.status = "exited";
    rec.exitCode = code;
    rec.exitSignal = signal;
    rec.child = null;
    logInfo(`Service launcher: ${key} exited`, { code, signal });
  });

  logInfo(`Service launcher: ${key} started`, { pid: child.pid, entry: def.entry });
  return { key, pid: child.pid, startedAt: rec.startedAt };
}

/**
 * Kill the process (and, for multi-process supervisors, its whole tree) and
 * resolve once it exits or a timeout elapses.
 */
function killTree(rec) {
  return new Promise((resolve) => {
    const child = rec.child;
    if (!child) return resolve();

    let settled = false;
    let timer = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);

    try {
      if (IS_WINDOWS) {
        // Windows has no real signals; taskkill /T /F ends the whole tree.
        spawn("taskkill", ["/PID", String(rec.pid), "/T", "/F"], { windowsHide: true });
      } else {
        // Negative pid → the detached process group (parent + children).
        process.kill(-rec.pid, "SIGTERM");
      }
    } catch (err) {
      // Fall back to a direct kill of just the parent.
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }

    timer = setTimeout(() => {
      try {
        if (IS_WINDOWS) spawn("taskkill", ["/PID", String(rec.pid), "/T", "/F"], { windowsHide: true });
        else process.kill(-rec.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
      done();
    }, STOP_TIMEOUT_MS);
  });
}

async function stop(key) {
  if (!isManageable(key)) {
    const err = new Error(`Unknown service: ${key}`);
    err.statusCode = 404;
    throw err;
  }

  const rec = managed.get(key);
  if (!rec || rec.status !== "running" || !rec.child) {
    return { key, alreadyStopped: true };
  }

  await killTree(rec);
  logInfo(`Service launcher: ${key} stopped`, { pid: rec.pid });
  return { key, stopped: true };
}

function stateOf(key) {
  const def = LAUNCHERS[key];
  const rec = managed.get(key);
  return {
    key,
    name: def.name,
    startCommand: def.startCommand,
    multiProcess: def.multiProcess === true,
    manageable: true,
    managed: !!rec,
    status: rec ? rec.status : "not-started",
    pid: rec && rec.status === "running" ? rec.pid : null,
    startedAt: rec ? rec.startedAt : null,
    exitCode: rec ? rec.exitCode : null,
    exitSignal: rec ? rec.exitSignal : null,
    error: rec ? rec.error : null,
    logs: rec ? rec.logs.slice(-25) : [],
  };
}

function getState() {
  return Object.keys(LAUNCHERS).map(stateOf);
}

let shuttingDown = false;

/**
 * Gracefully stop every service this module started — a SIGTERM tree-kill with a
 * SIGKILL fallback (see killTree). Safe to call repeatedly. This is what the host
 * app's graceful-shutdown handlers (SIGINT/SIGTERM/SIGHUP) should await so the
 * child processes — including Farm Stay's five leaves — exit cleanly *before* the
 * app itself exits, rather than being orphaned.
 */
async function shutdownAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  const running = [...managed.values()].filter((rec) => rec.status === "running" && rec.child);
  if (!running.length) return;
  logInfo("Service launcher: stopping launched services on app shutdown", { count: running.length });
  await Promise.all(running.map((rec) => killTree(rec)));
}

/**
 * Synchronous forced cleanup — the guaranteed backstop. Registered on process
 * 'exit', which fires whenever the process exits via process.exit() (including
 * the app's signal handlers and its uncaughtException/unhandledRejection paths
 * that call process.exit(1)). Because 'exit' handlers must be synchronous, this
 * force-kills the whole tree without awaiting: taskkill /T /F on Windows, or a
 * SIGKILL to the detached process group on POSIX. Without this, stopping the app
 * would leave the started services running and holding their ports.
 */
function killAllSync() {
  for (const rec of managed.values()) {
    const serviceName = Object.entries(LAUNCHERS).find(([k]) => managed.get(k) === rec)?.[1]?.name || "unknown";
    if (!rec.child || rec.status !== "running") continue;
    try {
      if (IS_WINDOWS) {
        logDebug(`Service launcher: force-killing ${serviceName} (${rec.pid}) on app exit`);
        spawnSync("taskkill", ["/PID", String(rec.pid), "/T", "/F"], { windowsHide: true });
      } else {
        try {
          process.kill(-rec.pid, "SIGKILL"); // negative pid → detached process group
        } catch {
          rec.child.kill("SIGKILL");
        }
      }
    } catch {
      /* best effort — nothing more we can do while exiting */
      logDebug(`Service launcher: failed to force-kill ${serviceName} (${rec.pid}) on app exit`);
    }
  }
}

process.on("exit", killAllSync);

module.exports = {
  start,
  stop,
  shutdownAll,
  getState,
  stateOf,
  isManageable,
  // exposed for tests
  LAUNCHERS,
};
