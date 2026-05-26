module.exports = {
  name: "harvest-moon-header-plugin",
  order: 40,
  enabled: false,
  autoDiscoverable: false,

  config: {
    routePaths: ["/api/v1/healthcheck", "/api/v1/ping"],
    queryParam: "moon",
    queryValue: "harvest",
    headerName: "x-rolnopol-harvest-moon",
    headerValue: "golden-fields-awake",
  },

  onResponse({ req, res, config }) {
    if (req.method !== "GET" || res.headersSent) {
      return;
    }

    const routePaths = Array.isArray(config.routePaths) ? config.routePaths : [];
    if (routePaths.length > 0 && !routePaths.includes(req.path)) {
      return;
    }

    const queryParam = typeof config.queryParam === "string" && config.queryParam.trim().length > 0 ? config.queryParam : "moon";
    const expectedValue = String(config.queryValue || "harvest")
      .trim()
      .toLowerCase();
    const actualValue = String(req.query?.[queryParam] || "")
      .trim()
      .toLowerCase();

    if (!actualValue || actualValue !== expectedValue) {
      return;
    }

    const headerName = config.headerName || "x-rolnopol-harvest-moon";
    const headerValue = config.headerValue || "golden-fields-awake";
    res.setHeader(headerName, headerValue);
  },
};
