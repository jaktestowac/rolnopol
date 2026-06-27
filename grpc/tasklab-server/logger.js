/**
 * Tiny tagged logger for the TaskLab gRPC process.
 *
 * Keeps the "[tasklab-grpc] ..." prefix consistent across modules and adds an
 * ISO timestamp + level. Set TASKLAB_LOG=silent (or =error) to quiet the output
 * — handy for test runs that boot a real server.
 */
const TAG = "[tasklab-grpc]";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold() {
  const raw = String(process.env.TASKLAB_LOG || "info").toLowerCase();
  return LEVELS[raw] != null ? LEVELS[raw] : LEVELS.info;
}

function format(level, message, fields) {
  const ts = new Date().toISOString();
  let line = `${ts} ${TAG} ${level.toUpperCase()} ${message}`;
  if (fields && typeof fields === "object") {
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (parts.length) line += ` ${parts.join(" ")}`;
  }
  return line;
}

function emit(level, message, fields) {
  if (LEVELS[level] < threshold()) return;
  const line = format(level, message, fields);
  // eslint-disable-next-line no-console
  const sink = level === "error" || level === "warn" ? console.error : console.log;
  sink(line);
}

module.exports = {
  debug: (message, fields) => emit("debug", message, fields),
  info: (message, fields) => emit("info", message, fields),
  warn: (message, fields) => emit("warn", message, fields),
  error: (message, fields) => emit("error", message, fields),
};
