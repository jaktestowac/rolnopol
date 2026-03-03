const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logDebug } = require("../helpers/logger-api");
const chaosEngineService = require("../services/chaos-engine.service");
const prometheusMetrics = require("../helpers/prometheus-metrics");

// internal state for new features
let statefulCounter = 0;

// Ring buffer for mirrored requests (max 1000 entries to prevent unbounded growth)
const MAX_MIRRORED_REQUESTS = 1000;
class RingBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.buffer = [];
    this.index = 0;
  }

  push(item) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item);
    } else {
      this.buffer[this.index] = item;
      this.index = (this.index + 1) % this.maxSize;
    }
  }

  getAll() {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
    this.index = 0;
  }
}

const mirroredRequests = new RingBuffer(MAX_MIRRORED_REQUESTS);

// Memoized regex cache to avoid recompiling the same patterns
const regexCache = new Map();
const MAX_REGEX_CACHE_SIZE = 100;

// helper exported for tests
function getMirroredRequests() {
  return mirroredRequests.getAll();
}
module.exports.getMirroredRequests = getMirroredRequests;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldTrigger(probability) {
  return probability > 0 && Math.random() < probability;
}

function pickRandom(array, fallback) {
  if (!Array.isArray(array) || array.length === 0) {
    return fallback;
  }
  const index = Math.floor(Math.random() * array.length);
  return array[index];
}

function randomInt(min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

// pattern helpers for include/exclude lists with memoization
function toRegex(pattern) {
  // Check cache first
  const cacheKey = String(pattern);
  if (regexCache.has(cacheKey)) {
    return regexCache.get(cacheKey);
  }

  let regex;
  if (pattern instanceof RegExp) {
    regex = pattern;
  } else {
    const str = String(pattern);
    // allow regex literal notation /foo/ or /foo/i
    if (str.startsWith("/") && str.lastIndexOf("/") > 0) {
      const last = str.lastIndexOf("/");
      const body = str.slice(1, last);
      const flags = str.slice(last + 1);
      try {
        regex = new RegExp(body, flags);
      } catch (e) {
        // fall through to wildcard
        regex = null;
      }
    }

    // escape regex meta and convert * to .*
    if (!regex) {
      const esc = str.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const wildcard = esc.replace(/\\\*/g, ".*");
      regex = new RegExp(`^${wildcard}$`);
    }
  }

  // Store in cache with eviction policy (simple LRU)
  if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
    const firstKey = regexCache.keys().next().value;
    regexCache.delete(firstKey);
  }
  regexCache.set(cacheKey, regex);

  return regex;
}

function matchesPattern(value, pattern) {
  if (value == null || pattern == null) {
    return false;
  }
  const regex = toRegex(pattern);
  return regex.test(String(value));
}

function matchesAnyPattern(value, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((p) => matchesPattern(value, p));
}

function isPathExcluded(path, excludedPrefixes) {
  if (!Array.isArray(excludedPrefixes) || excludedPrefixes.length === 0) {
    return false;
  }

  return excludedPrefixes.some((prefix) => {
    if (typeof prefix !== "string" || prefix.length === 0) {
      return false;
    }
    return path === prefix || path.startsWith(prefix) || path.includes(prefix);
  });
}

// Perform actual HTTP mirror request asynchronously
async function performMirrorRequest(method, path, originalReq, targetUrl, mirrorRecord) {
  if (!targetUrl) {
    logDebug("Mirror target URL not configured, skipping", { path });
    mirrorRecord.status = "skipped";
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const fullUrl = `${targetUrl}${path}`;
    const fetchOptions = {
      method: method || "GET",
      signal: controller.signal,
      timeout: 5000,
    };

    // Copy relevant headers and body if present
    if (originalReq.body) {
      fetchOptions.headers = originalReq.headers;
      fetchOptions.body = JSON.stringify(originalReq.body);
    } else if (originalReq.headers) {
      fetchOptions.headers = originalReq.headers;
    }

    const response = await fetch(fullUrl, fetchOptions);

    logDebug("Mirror request succeeded", {
      method,
      path,
      targetUrl,
      status: response.status,
    });

    prometheusMetrics.recordChaosEvent("mirroring-success", "custom", path);
    mirrorRecord.status = "success";
    mirrorRecord.statusCode = response.status;
  } catch (error) {
    logError("Mirror request failed", {
      message: error instanceof Error ? error.message : String(error),
      targetUrl,
      path,
    });

    prometheusMetrics.recordChaosEvent("mirroring-failure", "custom", path);
    mirrorRecord.status = "failed";
    mirrorRecord.error = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function chaosEngineMiddleware(req, res, next) {
  try {
    // fetch the public configuration; it contains the resolved runtime config as `config`
    const publicConfig = await chaosEngineService.getChaosEngineConfig();
    const runtimeConfig = publicConfig.config || {};

    const currentMode = publicConfig.mode || "unknown";

    // always bypass chaos for control plane operations, including reset/config
    if (req.path && req.path.startsWith("/v1/chaos-engine")) {
      return next();
    }

    // if chaos engine is not enabled, skip all chaos logic and just call next()
    if (!runtimeConfig.enabled) {
      return next();
    }

    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "");
    const scope = runtimeConfig.scope || {};

    // convenience: support header for testing roles if authentication middleware is absent
    if (!req.user && req.headers["x-user-roles"]) {
      req.user = {
        roles: String(req.headers["x-user-roles"])
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
      };
    }

    // traffic targeting: skip chaos for some percentage of requests
    const percent = Number(scope.percentOfTraffic);
    if (percent >= 0 && percent < 100) {
      if (Math.random() * 100 >= percent) {
        return next();
      }
    }

    // methods filter
    if (Array.isArray(scope.methods) && scope.methods.length > 0 && !scope.methods.includes(method)) {
      return next();
    }

    // includePaths: if defined, only apply chaos when path matches one
    let includedByPath = false;
    if (Array.isArray(scope.includePaths) && scope.includePaths.length > 0) {
      if (!matchesAnyPattern(path, scope.includePaths)) {
        return next();
      }
      includedByPath = true;
    }

    // excludePaths normally filters out traffic unless the path was explicitly included
    if (!includedByPath && isPathExcluded(path, scope.excludePaths)) {
      return next();
    }

    // query parameter filtering
    if (scope.queryParams && typeof scope.queryParams === "object") {
      for (const [key, pattern] of Object.entries(scope.queryParams)) {
        const val = req.query ? req.query[key] : undefined;
        if (!matchesPattern(val, pattern)) {
          return next();
        }
      }
    }

    // header filtering (names case-insensitive)
    if (scope.headers && typeof scope.headers === "object") {
      for (const [name, pattern] of Object.entries(scope.headers)) {
        const val = req.headers ? req.headers[name.toLowerCase()] : undefined;
        if (!matchesPattern(val, pattern)) {
          return next();
        }
      }
    }

    // hostname filtering
    if (Array.isArray(scope.hostnames) && scope.hostnames.length > 0) {
      const host = req.hostname || req.headers.host || "";
      if (!matchesAnyPattern(host, scope.hostnames)) {
        return next();
      }
    }

    // role filtering
    if (Array.isArray(scope.roles) && scope.roles.length > 0) {
      const userRoles = req.user && Array.isArray(req.user.roles) ? req.user.roles : [];
      if (!userRoles.some((r) => scope.roles.includes(r))) {
        return next();
      }
    }

    // IP range filtering (simple prefix/regex)
    if (Array.isArray(scope.ipRanges) && scope.ipRanges.length > 0) {
      const ip = req.ip || (req.connection && req.connection.remoteAddress) || "";
      if (!matchesAnyPattern(ip, scope.ipRanges)) {
        return next();
      }
    }

    // geolocation header filtering (x-geo or custom header value)
    if (Array.isArray(scope.geolocation) && scope.geolocation.length > 0) {
      const geo = req.headers["x-geo"] || "";
      if (!matchesAnyPattern(geo, scope.geolocation)) {
        return next();
      }
    }

    const latency = runtimeConfig.latency || {};
    if (latency.enabled === true && shouldTrigger(Number(latency.probability) || 0)) {
      const waitMs = randomInt(Number(latency.minMs) || 0, Number(latency.maxMs) || 0);
      if (waitMs > 0) {
        await sleep(waitMs);
        res.setHeader("X-Chaos-Latency-Ms", String(waitMs));
      }
      // record event and log
      prometheusMetrics.recordChaosEvent("latency", currentMode, path);
    }

    const responseLoss = runtimeConfig.responseLoss || {};
    if (responseLoss.enabled === true && shouldTrigger(Number(responseLoss.probability) || 0)) {
      const mode = String(responseLoss.mode || "timeout").toLowerCase();
      res.setHeader("X-Chaos-Effect", "response-loss");

      // record metric & log before effect
      prometheusMetrics.recordChaosEvent("response-loss", currentMode, path);

      // modes that simply kill the socket immediately
      if (mode === "drop" || mode === "reset") {
        if (req.socket && typeof req.socket.destroy === "function") {
          req.socket.destroy();
          return;
        }
      }

      // partial responses: send a small chunk then tear down the connection
      if (mode === "partial") {
        // attempt to send something so the client sees headers and part of the body
        try {
          res.status(200);
          res.write(JSON.stringify({ error: "partial response" }).slice(0, 10));
        } catch (e) {
          // ignore any write errors
        }
        if (req.socket && typeof req.socket.destroy === "function") {
          req.socket.destroy();
        }
        return;
      }

      // default behaviour: timeout/504
      const timeoutMs = Number(responseLoss.timeoutMs) || 1500;
      return res.status(504).json(
        formatResponseBody({
          error: `Chaos Engine simulated a lost response (timeout after ${timeoutMs}ms)`,
        }),
      );
    }

    // stateful behaviour: count requests and trigger fault once threshold reached
    const stateful = runtimeConfig.stateful || {};
    if (stateful.enabled === true) {
      const threshold = Number(stateful.requestCount) || 0;
      if (threshold > 0) {
        statefulCounter += 1;
        if (statefulCounter > threshold) {
          statefulCounter = 0;
          res.setHeader("X-Chaos-Effect", "stateful-trigger");
          prometheusMetrics.recordChaosEvent("stateful-trigger", currentMode, path);
          return res.status(500).json(formatResponseBody({ error: "Chaos Engine stateful fault" }));
        }
      }
    }

    // mirroring / shadowing logic (fire-and-forget with actual HTTP request)
    const mirroring = runtimeConfig.mirroring || {};
    if (mirroring.enabled === true && shouldTrigger(Number(mirroring.probability) || 0)) {
      const mirrorRecord = { method, path, timestamp: Date.now(), status: "pending" };
      mirroredRequests.push(mirrorRecord);
      res.setHeader("X-Chaos-Mirrored", "1");
      prometheusMetrics.recordChaosEvent("mirroring", currentMode, path);

      // Send mirror request asynchronously (fire-and-forget)
      setImmediate(() => {
        performMirrorRequest(method, path, req, mirroring.targetUrl, mirrorRecord).catch((error) => {
          logError("Mirror request failed", { error, path });
        });
      });
    }

    const errorInjection = runtimeConfig.errorInjection || {};
    if (errorInjection.enabled === true && shouldTrigger(Number(errorInjection.probability) || 0)) {
      let statusCode;
      if (errorInjection.randomStatus === true) {
        // treat first two entries as min/max
        const codes = Array.isArray(errorInjection.statusCodes) ? errorInjection.statusCodes : [];
        if (codes.length >= 2) {
          const min = Math.min(Number(codes[0]), Number(codes[1]));
          const max = Math.max(Number(codes[0]), Number(codes[1]));
          statusCode = randomInt(min, max);
        } else {
          statusCode = Number(pickRandom(errorInjection.statusCodes, 500));
        }
      } else {
        statusCode = Number(pickRandom(errorInjection.statusCodes, 500));
      }
      const message = String(errorInjection.message || "Chaos Engine injected a synthetic error response");

      res.setHeader("X-Chaos-Effect", "error-injection");
      // record metric & log
      prometheusMetrics.recordChaosEvent("error-injection", currentMode, path);

      return res.status(statusCode).json(formatResponseBody({ error: message }));
    }

    return next();
  } catch (error) {
    // ensure we log full stack for easier debugging
    const { logError } = require("../helpers/logger-api");
    logError("Chaos Engine middleware failed. Request will continue without chaos effects.", {
      error: error instanceof Error ? error.stack || error.message : error,
    });
    return next();
  }
}

// expose helpers on the exported function
chaosEngineMiddleware.getMirroredRequests = getMirroredRequests;
module.exports = chaosEngineMiddleware;
