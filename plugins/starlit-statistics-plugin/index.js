module.exports = {
  name: "starlit-statistics-plugin",
  order: 55,
  enabled: false,
  autoDiscoverable: false,

  config: {
    routePath: "/api/v1/statistics",
    queryParam: "constellation",
    queryValue: "lyra",
    title: "Lyra over Rolnopol",
  },

  onResponse({ req, responseBody, responseType, config }) {
    if (req.method !== "GET" || req.path !== config.routePath || responseType !== "json") {
      return;
    }

    if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
      return;
    }

    const queryParam = typeof config.queryParam === "string" && config.queryParam.trim().length > 0 ? config.queryParam : "constellation";
    const expectedValue = String(config.queryValue || "lyra")
      .trim()
      .toLowerCase();
    const actualValue = String(req.query?.[queryParam] || "")
      .trim()
      .toLowerCase();

    if (actualValue !== expectedValue) {
      return;
    }

    const farms = Number(responseBody.farms) || 0;
    const animals = Number(responseBody.animals) || 0;
    const staff = Number(responseBody.staff) || 0;
    const users = Number(responseBody.users) || 0;

    responseBody.meta = {
      ...(responseBody.meta || {}),
      easterEgg: {
        id: "starlit-statistics",
        title: config.title || "Lyra over Rolnopol",
        constellation: expectedValue,
        chorus: `Lyra counted ${farms} farms, ${animals} animals, ${staff} staff, and ${users} steady hands under one patient sky.`,
      },
    };
  },
};
