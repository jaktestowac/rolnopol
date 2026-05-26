const { formatResponseBody } = require("../../helpers/response-helper");

module.exports = {
  name: "secret-garden-route-plugin",
  order: 20,
  enabled: false,
  autoDiscoverable: false,

  config: {
    routePath: "/api/v1/easter-eggs/secret-garden",
    phrase: "Moss remembers every footprint.",
    flowers: ["moonflower", "fern", "cornflower"],
  },

  onRequest({ req, res, config }) {
    if (req.path !== config.routePath) {
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json(
        formatResponseBody({
          error: "Method not allowed",
        }),
      );
      return false;
    }

    res.status(200).json(
      formatResponseBody({
        message: "Hidden grove unlocked",
        data: {
          path: config.routePath,
          phrase: config.phrase,
          flowers: Array.isArray(config.flowers) ? config.flowers : [],
        },
        meta: {
          easterEgg: {
            id: "secret-garden-route",
            phrase: config.phrase,
          },
        },
      }),
    );

    return false;
  },
};
