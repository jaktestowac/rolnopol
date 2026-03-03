const CHAOS_ENGINE_DEFAULT_SCOPE = {
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  // existing exclusion list used during normal operation
  // prefix with * to protect all subpaths (reset, config, etc.)
  excludePaths: ["/v1/chaos-engine*", "/v1/healthcheck", "/version", "/metrics", "/admin", "/feature-flags"],
  // new scoping options (empty by default so they do not restrict traffic)
  includePaths: [], // allowlist regex/wildcard strings
  queryParams: {}, // key/value map, supports wildcard or regex patterns
  headers: {}, // header name -> pattern
  hostnames: [], // list of allowed hostnames
  roles: [], // authenticated user roles to target
  ipRanges: [], // simple prefix or regex matching against req.ip
  geolocation: [], // values from x-geo header or similar
  percentOfTraffic: 100, // support targeting a subset of traffic
};

const CHAOS_ENGINE_DEFAULT_CUSTOM_CONFIG = {
  enabled: true,
  latency: {
    enabled: true,
    probability: 0.2,
    minMs: 120,
    maxMs: 400,
  },
  responseLoss: {
    enabled: false,
    probability: 0.02,
    mode: "timeout",
    timeoutMs: 1500,
  },
  errorInjection: {
    enabled: true,
    probability: 0.06,
    statusCodes: [500, 502, 503],
    randomStatus: false, // when true, treat statusCodes array as [min,max]
    message: "[Chaos Engine] Injected a synthetic backend error.",
  },
  stateful: {
    enabled: false,
    // number of requests to let through before a forced failure occurs
    requestCount: 0,
  },
  mirroring: {
    enabled: false,
    probability: 0,
    targetUrl: "",
  },
  scope: {
    ...CHAOS_ENGINE_DEFAULT_SCOPE,
    // customConfig inherits defaults but we re-specify percentOfTraffic for clarity
    percentOfTraffic: 100,
  },
};

const CHAOS_ENGINE_DEFAULT_DATA = {
  mode: "off",
  customConfig: CHAOS_ENGINE_DEFAULT_CUSTOM_CONFIG,
  updatedAt: null,
};

module.exports = {
  CHAOS_ENGINE_DEFAULT_SCOPE,
  CHAOS_ENGINE_DEFAULT_CUSTOM_CONFIG,
  CHAOS_ENGINE_DEFAULT_DATA,
};
