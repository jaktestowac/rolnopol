module.exports = {
  name: "sample-plugin-route",
  order: 500,
  enabled: false,
  autoDiscoverable: true,

  config: {
    // The path this plugin will listen on; can be changed via plugins.manifest.json overrides
    routePath: "/api/sample-plugin-route",
  },

  init({ logInfo, config }) {
    logInfo("sample-plugin-route initialized", {
      routePath: config.routePath,
    });
  },

  onRequest({ req, res, config, logInfo }) {
    if (req.path !== config.routePath) {
      return;
    }

    logInfo("sample-plugin-route handling request", { method: req.method, path: req.path });

    if (req.method === "GET") {
      res.json({ message: "Hello from sample-plugin-route (GET)" });
      return false; // stop other plugins from running for this request
    }

    if (req.method === "POST") {
      res.json({ message: "Hello from sample-plugin-route (POST)", body: req.body });
      return false; // stop other plugins from running for this request
    }

    res.status(405).json({ error: "Method not allowed" });
    return false;
  },
};
