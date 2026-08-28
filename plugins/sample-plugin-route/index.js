/**
 * The reference example for a plugin that owns endpoints.
 *
 * It uses `registerRoutes`, so its router is mounted at /api/v1/plugins/sample-plugin-route
 * and cannot shadow a core route. Matching paths inside `onRequest` still works and is what
 * the easter-egg plugins do, but that runs above auth, rate limiting and request logging,
 * and a path claimed there is invisible to the OpenAPI coverage tests.
 */
module.exports = {
  name: "sample-plugin-route",
  order: 500,
  enabled: false,
  autoDiscoverable: true,

  config: {
    // Included in every answer, to show config reaching a route handler.
    greeting: "Hello from sample-plugin-route",
  },

  init({ logInfo }) {
    logInfo("sample-plugin-route initialized", { mountPath: "/api/v1/plugins/sample-plugin-route" });
  },

  registerRoutes({ router, config, logInfo }) {
    const greeting = () => config?.greeting || "Hello from sample-plugin-route";

    router.get("/", (req, res) => {
      logInfo("sample-plugin-route handling request", { method: req.method, path: req.originalUrl });
      res.json({ message: `${greeting()} (GET)` });
    });

    router.post("/", (req, res) => {
      logInfo("sample-plugin-route handling request", { method: req.method, path: req.originalUrl });
      res.json({ message: `${greeting()} (POST)`, body: req.body });
    });

    // The router answers 405 itself rather than falling through to the app's 404, so a
    // wrong method on a real path still reads as a wrong method.
    router.all("/", (req, res) => {
      res.status(405).json({ error: "Method not allowed" });
    });
  },
};
