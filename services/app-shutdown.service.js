const { logInfo, logError } = require("../helpers/logger-api");

/**
 * The application's single graceful-shutdown sequence.
 *
 * It lives here rather than inline in `api/index.js` because there are now two
 * ways to stop the app — a signal (SIGINT/SIGTERM/SIGHUP) and the localhost-only
 * `GET /api/v1/shutdown` endpoint — and both must run the exact same teardown.
 * The endpoint previously called `process.exit(0)` outright, which orphaned
 * launched external services and dropped debounced JSON database writes.
 *
 * Note the module-level requires are lazy (inside `shutdownApplication`): the
 * teardown targets are only needed when we are actually going down, and keeping
 * them out of module load order avoids adding a require cycle to the boot path.
 */

let shutdownInProgress = false;

/**
 * Run one teardown step, swallowing its failure.
 *
 * Every step is best-effort by design: shutdown must reach `process.exit` even
 * if a plugin or a WebSocket gateway throws on the way out. Without this, a
 * single rejection would leave the process alive with half its subsystems down.
 *
 * @param {string} label - step name, used in the error log
 * @param {() => unknown} action - the step itself; may be sync or async
 */
async function runStep(label, action) {
  try {
    await action();
  } catch (error) {
    logError(`Error during shutdown step "${label}"`, { error: error?.message || error });
  }
}

/**
 * Defensive require, matching how `api/index.js` loads its optional subsystems:
 * a module that cannot load must not be able to block shutdown.
 *
 * @param {string} modulePath
 * @returns {object|null}
 */
function loadOptional(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    logError(`Shutdown could not load ${modulePath}`, { error: error?.message || error });
    return null;
  }
}

/**
 * Stop plugins, close the WebSocket gateways, stop the Notification Center,
 * flush databases, stop externally launched services, then exit the process.
 *
 * Idempotent: concurrent or repeated calls after the first are no-ops, so a
 * second SIGINT (or a second request to the shutdown endpoint) cannot interleave
 * two teardowns.
 *
 * @param {Object} [options]
 * @param {string} [options.reason] - what triggered the shutdown, for the logs
 * @param {number} [options.exitCode] - process exit code
 * @param {(code: number) => void} [options.exit] - exit hook; injectable so tests
 *   can exercise the teardown without killing the test runner
 * @returns {Promise<boolean>} true when this call performed the shutdown, false
 *   when one was already in progress
 */
async function shutdownApplication(options = {}) {
  const { reason = "unknown", exitCode = 0, exit = (code) => process.exit(code) } = options;

  if (shutdownInProgress) return false;
  shutdownInProgress = true;

  logInfo("Graceful shutdown started", { reason });

  // Stop any external services started from the Kraken dashboard first, so they
  // aren't orphaned (still holding their ports) when the app goes down. This is
  // the graceful path; service-launcher also has a synchronous process 'exit'
  // backstop for crash/forced-exit paths.
  const serviceLauncher = loadOptional("./service-launcher.service");
  const pluginRuntime = loadOptional("../modules/plugin-runtime");
  const notificationCenter = loadOptional("../modules/notification-center");
  const notificationWebSocketService = loadOptional("./notification-ws.service");
  const messengerWebSocketService = loadOptional("./messenger-ws.service");
  const greenhouseWebSocketService = loadOptional("./greenhouse-ws.service");
  const databaseInit = loadOptional("../data/database-init");

  if (serviceLauncher) await runStep("launched external services", () => serviceLauncher.shutdownAll());
  if (pluginRuntime) await runStep("plugins", () => pluginRuntime.shutdown());
  if (notificationWebSocketService) await runStep("notification websocket", () => notificationWebSocketService.close());
  if (messengerWebSocketService) await runStep("messenger websocket", () => messengerWebSocketService.close());
  if (greenhouseWebSocketService) await runStep("greenhouse websocket", () => greenhouseWebSocketService.close());
  if (notificationCenter) await runStep("notification center", () => notificationCenter.stop());
  if (databaseInit) await runStep("databases", () => databaseInit.cleanupDatabases());

  logInfo("Graceful shutdown complete", { reason });
  exit(exitCode);

  return true;
}

/**
 * @returns {boolean} true once a shutdown has been started
 */
function isShuttingDown() {
  return shutdownInProgress;
}

/**
 * Test-only: clear the idempotency latch so a suite can drive the sequence more
 * than once. Never call this from application code.
 */
function resetForTests() {
  shutdownInProgress = false;
}

module.exports = {
  shutdownApplication,
  isShuttingDown,
  resetForTests,
};
