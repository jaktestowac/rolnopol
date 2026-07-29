/**
 * Tiny tagged logger for the AgriAcademy ecosystem.
 *
 * Each service creates a logger with its own tag, e.g. createLogger("exam-center").
 * Set AGRI_ACADEMY_LOG=silent (or =error/=warn/=debug) to change verbosity — handy
 * for test runs that boot real servers.
 *
 * Owned by the ecosystem — no dependency on Rolnopol.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold() {
  const raw = String(process.env.AGRI_ACADEMY_LOG || "info").toLowerCase();
  return LEVELS[raw] != null ? LEVELS[raw] : LEVELS.info;
}

function format(tag, level, message, fields) {
  const ts = new Date().toISOString();
  let line = `${ts} [agriacademy:${tag}] ${level.toUpperCase()} ${message}`;
  if (fields && typeof fields === "object") {
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (parts.length) line += ` ${parts.join(" ")}`;
  }
  return line;
}

function createLogger(tag) {
  const emit = (level, message, fields) => {
    if (LEVELS[level] < threshold()) return;
    const line = format(tag, level, message, fields);
    // eslint-disable-next-line no-console
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    sink(line);
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

module.exports = { createLogger };
