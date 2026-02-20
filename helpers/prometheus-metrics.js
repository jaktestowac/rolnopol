const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const requestCounters = new Map();
const requestDuration = new Map();
let metricsEnabled = false;

function setEnabled(enabled) {
  metricsEnabled = enabled === true;
}

function isEnabled() {
  return metricsEnabled;
}

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\"/g, '\\"').replace(/\n/g, "\\n");
}

function buildLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }

  const serialized = entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",");

  return `{${serialized}}`;
}

function getRouteLabel(req) {
  if (req.route && req.route.path) {
    const routePath = typeof req.route.path === "string" ? req.route.path : req.path;
    return `${req.baseUrl || ""}${routePath}` || "/";
  }
  return req.path || req.originalUrl || "/";
}

function getMetricKey(method, route, statusCode) {
  return `${method}|${route}|${statusCode}`;
}

function getOrInitDurationEntry(key) {
  let entry = requestDuration.get(key);
  if (!entry) {
    entry = {
      sum: 0,
      count: 0,
      buckets: DEFAULT_BUCKETS.map(() => 0),
      inf: 0,
    };
    requestDuration.set(key, entry);
  }
  return entry;
}

function observeRequest(req, res, next) {
  if (!metricsEnabled) {
    return next();
  }

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const endedAt = process.hrtime.bigint();
    const durationSeconds = Number(endedAt - startedAt) / 1e9;

    const method = req.method || "UNKNOWN";
    const route = getRouteLabel(req);
    const statusCode = String(res.statusCode || 0);
    const key = getMetricKey(method, route, statusCode);

    requestCounters.set(key, (requestCounters.get(key) || 0) + 1);

    const durationEntry = getOrInitDurationEntry(key);
    durationEntry.sum += durationSeconds;
    durationEntry.count += 1;

    let inAnyBucket = false;
    for (let i = 0; i < DEFAULT_BUCKETS.length; i += 1) {
      if (durationSeconds <= DEFAULT_BUCKETS[i]) {
        durationEntry.buckets[i] += 1;
        inAnyBucket = true;
        break;
      }
    }

    if (!inAnyBucket) {
      durationEntry.inf += 1;
    }
  });

  next();
}

function collect() {
  const memory = process.memoryUsage();
  const lines = [];

  lines.push("# HELP rolnopol_process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE rolnopol_process_uptime_seconds gauge");
  lines.push(`rolnopol_process_uptime_seconds ${process.uptime()}`);

  lines.push("# HELP rolnopol_process_memory_bytes Process memory usage in bytes.");
  lines.push("# TYPE rolnopol_process_memory_bytes gauge");
  lines.push(`rolnopol_process_memory_bytes${buildLabels({ area: "rss" })} ${memory.rss}`);
  lines.push(`rolnopol_process_memory_bytes${buildLabels({ area: "heapTotal" })} ${memory.heapTotal}`);
  lines.push(`rolnopol_process_memory_bytes${buildLabels({ area: "heapUsed" })} ${memory.heapUsed}`);
  lines.push(`rolnopol_process_memory_bytes${buildLabels({ area: "external" })} ${memory.external}`);
  lines.push(`rolnopol_process_memory_bytes${buildLabels({ area: "arrayBuffers" })} ${memory.arrayBuffers}`);

  lines.push("# HELP rolnopol_http_requests_total Total number of processed HTTP requests.");
  lines.push("# TYPE rolnopol_http_requests_total counter");

  for (const [key, count] of requestCounters.entries()) {
    const [method, route, statusCode] = key.split("|");
    lines.push(`rolnopol_http_requests_total${buildLabels({ method, route, status_code: statusCode })} ${count}`);
  }

  lines.push("# HELP rolnopol_http_request_duration_seconds HTTP request duration in seconds.");
  lines.push("# TYPE rolnopol_http_request_duration_seconds histogram");

  for (const [key, entry] of requestDuration.entries()) {
    const [method, route, statusCode] = key.split("|");
    let cumulative = 0;

    for (let i = 0; i < DEFAULT_BUCKETS.length; i += 1) {
      cumulative += entry.buckets[i];
      lines.push(
        `rolnopol_http_request_duration_seconds_bucket${buildLabels({ method, route, status_code: statusCode, le: String(DEFAULT_BUCKETS[i]) })} ${cumulative}`,
      );
    }

    lines.push(
      `rolnopol_http_request_duration_seconds_bucket${buildLabels({ method, route, status_code: statusCode, le: "+Inf" })} ${entry.count}`,
    );
    lines.push(`rolnopol_http_request_duration_seconds_sum${buildLabels({ method, route, status_code: statusCode })} ${entry.sum}`);
    lines.push(`rolnopol_http_request_duration_seconds_count${buildLabels({ method, route, status_code: statusCode })} ${entry.count}`);
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  setEnabled,
  isEnabled,
  observeRequest,
  collect,
};
