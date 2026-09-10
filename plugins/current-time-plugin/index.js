/**
 * Answers with the current server time.
 *
 * The smallest useful plugin that owns an endpoint: no state, no services, one route. It uses
 * `registerRoutes`, so its router is mounted at /api/v1/plugins/current-time-plugin and
 * cannot shadow a core route.
 */
const { formatResponseBody } = require("../../helpers/response-helper");

/** Rejects a bad time zone before Intl throws a RangeError deep inside the handler. */
function isSupportedTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  name: "current-time-plugin",
  order: 600,
  enabled: false,
  autoDiscoverable: false,

  config: {
    // Zone for the human-readable field. Null means whatever the server runs in.
    timeZone: null,
    // Locale for that same field.
    locale: "en-GB",
    // Where the router answers. Omit it for /api/v1/plugins/current-time-plugin; either
    // manifest can override it, and a path outside the plugin namespace is warned about
    // because it can shadow a real route.
    mountPath: "/api/v1/plugins/current-time-plugin",
  },

  // `mountPath` is injected by the runtime, already resolved, so nothing here repeats it.
  init({ logInfo, config, mountPath }) {
    logInfo("current-time-plugin initialized", {
      mountPath,
      timeZone: config?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  },

  registerRoutes({ router, config }) {
    /** The zone to answer in: ?timeZone= wins over config, config over the server's own. */
    const resolveTimeZone = (requested) => {
      const candidate = requested || config?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return typeof candidate === "string" && candidate.length > 0 ? candidate : "UTC";
    };

    router.get("/", (req, res) => {
      const requested = typeof req.query?.timeZone === "string" ? req.query.timeZone.trim() : "";

      if (requested && !isSupportedTimeZone(requested)) {
        res.status(400).json(
          formatResponseBody({
            error: "Unknown time zone",
            details: `"${requested}" is not an IANA time zone, for example Europe/Warsaw or UTC`,
          }),
        );
        return;
      }

      const now = new Date();
      const timeZone = resolveTimeZone(requested);
      const locale = typeof config?.locale === "string" && config.locale.length > 0 ? config.locale : "en-GB";

      res.status(200).json(
        formatResponseBody({
          message: "Current server time",
          data: {
            iso: now.toISOString(),
            epochMs: now.getTime(),
            timeZone,
            local: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone }).format(now),
          },
        }),
      );
    });

    // Answered here rather than left to fall through to the app's 404, so a wrong method on
    // a real path still reads as a wrong method.
    router.all("/", (req, res) => {
      res.status(405).json(formatResponseBody({ error: "Method not allowed" }));
    });
  },
};
