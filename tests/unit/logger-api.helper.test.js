import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logger = require("../../helpers/logger-api");
const settings = require("../../data/settings");

// Two pieces of module state are shared by every test in this file: the ring
// buffer and the active log level. Both are reset in beforeEach, and the console
// is silenced so a passing run stays readable — the assertions are about what the
// buffer holds, and about which console method was reached, not about the text.
const CONSOLE_METHODS = ["log", "warn", "error"];
const settingsSnapshot = {};

beforeEach(() => {
  logger.clearLogList();
  logger.setLogLevel("TRACE");
  for (const key of ["DEBUG_MODE", "LOG_TRACE", "LOG_REQUEST", "LOG_STACK_TRACE"]) {
    settingsSnapshot[key] = settings[key];
  }
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  Object.assign(settings, settingsSnapshot);
  logger.clearLogList();
  logger.setLogLevel("TRACE");
  vi.restoreAllMocks();
});

const levelsIn = () => logger.getLogList().map((entry) => entry.level);

describe("logger-api — log level selection", () => {
  it("defaults to TRACE, the most verbose level", () => {
    expect(logger.getLogLevel()).toBe("TRACE");
  });

  it("offers exactly the five levels an operator can pick, verbose first", () => {
    expect(logger.getAvailableLogLevels()).toEqual(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);
  });

  it("returns a copy of the level list, so a caller cannot edit the menu", () => {
    const first = logger.getAvailableLogLevels();
    first.push("SILENT");
    expect(logger.getAvailableLogLevels()).not.toContain("SILENT");
  });

  it("accepts a level in any case and with surrounding whitespace", () => {
    expect(logger.setLogLevel("warn")).toBe("WARN");
    expect(logger.getLogLevel()).toBe("WARN");
    expect(logger.setLogLevel("  Error  ")).toBe("ERROR");
    expect(logger.getLogLevel()).toBe("ERROR");
  });

  it("rejects a level that is not selectable and names the valid ones", () => {
    expect(() => logger.setLogLevel("SILENT")).toThrow(/Invalid log level: SILENT/);
    expect(() => logger.setLogLevel("SILENT")).toThrow(/TRACE, DEBUG, INFO, WARN, ERROR/);
  });

  it("rejects the aliases that exist only as internal ranks", () => {
    // WARNING, REQUEST and RESPONSE have ranks so entries can be filtered, but
    // they are not thresholds an operator may select.
    for (const level of ["WARNING", "REQUEST", "RESPONSE"]) {
      expect(() => logger.setLogLevel(level)).toThrow(/Invalid log level/);
    }
  });

  it("rejects empty and non-string input", () => {
    for (const value of ["", "   ", null, undefined, 30, {}]) {
      expect(() => logger.setLogLevel(value)).toThrow(/Invalid log level/);
    }
  });

  it("leaves the active level untouched when a change is rejected", () => {
    logger.setLogLevel("INFO");
    expect(() => logger.setLogLevel("nonsense")).toThrow();
    expect(logger.getLogLevel()).toBe("INFO");
  });
});

describe("logger-api — the level gate", () => {
  it("records everything at TRACE", () => {
    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = true;

    logger.logTrace("t");
    logger.logDebug("d");
    logger.logInfo("i");
    logger.logWarning("w");
    logger.logError("e");

    expect(levelsIn().sort()).toEqual(["DEBUG", "ERROR", "INFO", "TRACE", "WARN"]);
  });

  it("drops TRACE and DEBUG once the level is INFO", () => {
    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = true;
    logger.setLogLevel("INFO");

    logger.logTrace("t");
    logger.logDebug("d");
    logger.logInfo("i");
    logger.logWarning("w");
    logger.logError("e");

    expect(levelsIn().sort()).toEqual(["ERROR", "INFO", "WARN"]);
  });

  it("drops everything below WARN once the level is WARN", () => {
    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = true;
    logger.setLogLevel("WARN");

    logger.logTrace("t");
    logger.logDebug("d");
    logger.logInfo("i");
    logger.logWarning("w");
    logger.logError("e");

    expect(levelsIn().sort()).toEqual(["ERROR", "WARN"]);
  });

  it("keeps only errors at ERROR", () => {
    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = true;
    logger.setLogLevel("ERROR");

    logger.logTrace("t");
    logger.logDebug("d");
    logger.logInfo("i");
    logger.logWarning("w");
    logger.logError("e");

    expect(levelsIn()).toEqual(["ERROR"]);
  });

  it("suppresses the console call too, not just the buffer entry", () => {
    logger.setLogLevel("ERROR");

    logger.logInfo("quiet please");
    logger.logWarning("quiet please");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();

    logger.logError("loud");
    expect(console.error).toHaveBeenCalled();
  });

  it("gates REQUEST and RESPONSE at the DEBUG rank, alongside logDebug", () => {
    settings.DEBUG_MODE = true;
    settings.LOG_REQUEST = true;
    const req = { method: "GET", originalUrl: "/api/v1/ping", body: {} };
    const res = { statusCode: 200 };

    logger.setLogLevel("DEBUG");
    logger.logRequest(req);
    logger.logResponse(req, res, { ok: true });
    expect(levelsIn().sort()).toEqual(["REQUEST", "RESPONSE"]);

    logger.clearLogList();
    logger.setLogLevel("INFO");
    logger.logRequest(req);
    logger.logResponse(req, res, { ok: true });
    expect(logger.getLogList()).toHaveLength(0);
  });
});

describe("logger-api — the DEBUG_MODE and LOG_* flags", () => {
  it("keeps logDebug silent while DEBUG_MODE is off, whatever the level", () => {
    settings.DEBUG_MODE = false;
    logger.setLogLevel("TRACE");

    logger.logDebug("nope");

    expect(logger.getLogList()).toHaveLength(0);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("requires both DEBUG_MODE and LOG_TRACE for logTrace", () => {
    logger.setLogLevel("TRACE");

    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = false;
    logger.logTrace("no trace flag");
    expect(logger.getLogList()).toHaveLength(0);

    settings.DEBUG_MODE = false;
    settings.LOG_TRACE = true;
    logger.logTrace("no debug mode");
    expect(logger.getLogList()).toHaveLength(0);

    settings.DEBUG_MODE = true;
    settings.LOG_TRACE = true;
    logger.logTrace("both on");
    expect(levelsIn()).toEqual(["TRACE"]);
  });

  it("requires LOG_REQUEST for logRequest and DEBUG_MODE for logResponse", () => {
    const req = { method: "POST", originalUrl: "/api/v1/login", body: {} };

    settings.LOG_REQUEST = false;
    logger.logRequest(req);
    expect(logger.getLogList()).toHaveLength(0);

    settings.DEBUG_MODE = false;
    logger.logResponse(req, { statusCode: 201 }, { ok: true });
    expect(logger.getLogList()).toHaveLength(0);
  });

  it("logs INFO, WARN and ERROR regardless of DEBUG_MODE", () => {
    settings.DEBUG_MODE = false;

    logger.logInfo("i");
    logger.logWarning("w");
    logger.logError("e");

    expect(levelsIn().sort()).toEqual(["ERROR", "INFO", "WARN"]);
  });
});

describe("logger-api — entry shape", () => {
  it("stamps every entry with a level, an ISO timestamp and the message", () => {
    logger.logInfo("hello", { farm: 1 });

    const [entry] = logger.getLogList();
    expect(entry.level).toBe("INFO");
    expect(entry.message).toBe("hello");
    expect(entry.data).toEqual({ farm: 1 });
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it("records a null data payload rather than omitting the field", () => {
    logger.logInfo("no data");

    expect(logger.getLogList()[0]).toHaveProperty("data", null);
  });

  it("stores an Error's message when LOG_STACK_TRACE is off, and its stack when on", () => {
    const error = new Error("boom");

    settings.LOG_STACK_TRACE = false;
    logger.logError("failed", error);
    expect(logger.getLogList()[0].data).toBe("boom");

    logger.clearLogList();
    settings.LOG_STACK_TRACE = true;
    logger.logError("failed", error);
    expect(logger.getLogList()[0].data).toBe(error.stack);
  });

  it("applies the same Error handling to warnings", () => {
    settings.LOG_STACK_TRACE = false;
    logger.logWarning("careful", new Error("mind the gap"));

    expect(logger.getLogList()[0].data).toBe("mind the gap");
  });

  it("keeps a non-Error warning payload as the object it was given", () => {
    logger.logWarning("careful", { code: 42 });

    expect(logger.getLogList()[0].data).toEqual({ code: 42 });
  });
});

describe("logger-api — logRequest redaction", () => {
  const reqWith = (body) => ({ method: "POST", originalUrl: "/api/v1/login", body });

  beforeEach(() => {
    settings.LOG_REQUEST = true;
  });

  it("hides password and token, keeping the rest of the body", () => {
    logger.logRequest(reqWith({ email: "a@b.io", password: "secret", token: "abc123", remember: true }));

    const [entry] = logger.getLogList();
    expect(entry.body).toEqual({ email: "a@b.io", password: "[HIDDEN]", token: "[HIDDEN]", remember: true });
  });

  it("does not mutate the caller's request body while redacting", () => {
    const body = { password: "secret" };
    logger.logRequest(reqWith(body));

    expect(body.password).toBe("secret");
  });

  it("records method and url, and a null body when there is nothing to log", () => {
    logger.logRequest(reqWith({}));

    const [entry] = logger.getLogList();
    expect(entry).toMatchObject({ level: "REQUEST", method: "POST", url: "/api/v1/login", body: null });
  });

  it("handles a request with no body at all", () => {
    logger.logRequest({ method: "GET", originalUrl: "/api/v1/ping" });

    expect(logger.getLogList()[0].body).toBeNull();
  });
});

describe("logger-api — logResponse", () => {
  beforeEach(() => {
    settings.DEBUG_MODE = true;
  });

  it("records the method, url, status and body", () => {
    logger.logResponse({ method: "GET", originalUrl: "/api/v1/fields" }, { statusCode: 200 }, { count: 2 });

    expect(logger.getLogList()[0]).toMatchObject({
      level: "RESPONSE",
      method: "GET",
      url: "/api/v1/fields",
      status: 200,
      body: { count: 2 },
    });
  });

  it("still records the entry when there is no response body", () => {
    logger.logResponse({ method: "DELETE", originalUrl: "/api/v1/fields/1" }, { statusCode: 204 }, undefined);

    expect(logger.getLogList()[0]).toMatchObject({ status: 204, body: undefined });
  });
});

describe("logger-api — the ring buffer", () => {
  it("returns newest first", () => {
    logger.logInfo("first");
    logger.logInfo("second");
    logger.logInfo("third");

    expect(logger.getLogList().map((entry) => entry.message)).toEqual(["third", "second", "first"]);
  });

  it("caps at 500 entries, discarding the oldest", () => {
    for (let index = 0; index < 520; index += 1) {
      logger.logInfo(`entry-${index}`);
    }

    const list = logger.getLogList();
    expect(list).toHaveLength(500);
    expect(list[0].message).toBe("entry-519");
    expect(list.at(-1).message).toBe("entry-20"); // entries 0..19 fell off the end
  });

  it("returns a copy, so a caller cannot edit or truncate the real buffer", () => {
    logger.logInfo("kept");

    const list = logger.getLogList();
    list.pop();
    list.push({ level: "FAKE" });

    const fresh = logger.getLogList();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].message).toBe("kept");
  });

  it("clearLogList empties the buffer and reports how many entries it removed", () => {
    logger.logInfo("a");
    logger.logInfo("b");

    expect(logger.clearLogList()).toBe(2);
    expect(logger.getLogList()).toEqual([]);
    expect(logger.clearLogList()).toBe(0);
  });

  it("does not count suppressed entries towards the buffer", () => {
    logger.setLogLevel("ERROR");
    logger.logInfo("dropped");
    logger.logWarning("dropped");

    expect(logger.clearLogList()).toBe(0);
  });
});
