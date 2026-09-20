/**
 * Express router introspection for the OpenAPI generator.
 *
 * Walks a live `express.Router` and reports every mounted operation together
 * with the middleware chain that guards it. This is what makes schema coverage
 * total rather than opt-in: an endpoint is described because it is *mounted*,
 * not because somebody remembered to annotate it.
 *
 * Middleware is only legible here because the factories in middleware/ tag the
 * functions they return (`featureFlag`, `authKind`, `rateLimitType`) — the
 * flag name and auth mode are otherwise sealed inside a closure.
 */

const fs = require("fs");
const path = require("path");

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];

/**
 * Decode the literal path a layer is mounted at from its Express regexp.
 *
 * Express 4 keeps no plain-text copy of the mount path, so it has to be read
 * back out of the compiled regexp. Every mount in this codebase is literal
 * (no params), so anything that does not decode cleanly is a bug worth
 * shouting about rather than guessing at — hence the null return.
 *
 * @returns {string|null} literal prefix ("" for a `/` mount), or null if the
 *   mount path is not a plain literal.
 */
function mountPrefix(layer) {
  const re = layer.regexp;
  if (!re || re.fast_slash) return "";

  let source = re.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "") // `.use()` mount (end: false)
    .replace(/\\\/\?\$$/, "") // route mount (end: true)
    .replace(/\$$/, "")
    .replace(/\\\//g, "/");

  return /^[A-Za-z0-9/_.-]*$/.test(source) ? source : null;
}

function isRouter(handle) {
  return typeof handle === "function" && Array.isArray(handle.stack);
}

/**
 * Walk a router, yielding one record per (method, path) pair.
 *
 * Middleware accumulates in registration order, exactly as Express applies it:
 * a `router.use("/farm-stay", requireFeatureFlag(...))` registered before a
 * route guards that route, and one registered after it does not. Several route
 * files gate whole subsystems that way, so ignoring order would silently drop
 * the flag from every Farm Stay and Greenhouse operation.
 *
 * @returns {Array<{method: string, path: string, route: object, middleware: Function[]}>}
 */
function collectOperations(router, { basePath = "", inherited = [] } = {}) {
  const operations = [];
  /** Path-scoped `.use()` middleware seen so far at this level. */
  const scoped = [];

  for (const layer of router.stack) {
    if (layer.route) {
      const localPath = layer.route.path;
      const applicable = [
        ...inherited,
        ...scoped.filter((entry) => entry.regexp.test(localPath)).map((entry) => entry.handle),
        ...layer.route.stack.map((sub) => sub.handle),
      ];

      for (const method of Object.keys(layer.route.methods)) {
        if (!HTTP_METHODS.includes(method)) continue;
        operations.push({
          method,
          path: joinPath(basePath, localPath),
          route: layer.route,
          middleware: applicable,
        });
      }
      continue;
    }

    if (isRouter(layer.handle)) {
      const prefix = mountPrefix(layer);
      if (prefix === null) {
        throw new Error(`Cannot decode mount path for a sub-router (regexp: ${layer.regexp && layer.regexp.source})`);
      }
      const probe = prefix || "/";
      operations.push(
        ...collectOperations(layer.handle, {
          basePath: joinPath(basePath, prefix),
          inherited: [...inherited, ...scoped.filter((entry) => entry.regexp.test(probe)).map((entry) => entry.handle)],
        }),
      );
      continue;
    }

    // Plain middleware mounted with `.use()` — guards everything registered after it.
    scoped.push({ regexp: layer.regexp, handle: layer.handle });
  }

  return operations;
}

function joinPath(base, segment) {
  const joined = `${base}${segment}`.replace(/\/{2,}/g, "/");
  if (joined === "") return "/";
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/**
 * Express path -> OpenAPI path. `:id` becomes `{id}`; the single wildcard route
 * (`/terminal/files/*`) becomes a named path parameter, since OpenAPI has no
 * wildcard notation.
 */
function toOpenApiPath(expressPath) {
  return expressPath.replace(/\/\*$/, "/{filePath}").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Names of the path parameters in an OpenAPI-style path. */
function pathParameters(openApiPath) {
  return [...openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

/**
 * Read the tags the middleware factories left behind.
 *
 * @returns {{featureFlag: string|null, resourceName: string|null, authKind: string|null, rateLimit: string|null}}
 */
function describeMiddleware(middleware) {
  const description = { featureFlag: null, resourceName: null, authKind: null, rateLimit: null };

  for (const handle of middleware) {
    if (typeof handle !== "function") continue;
    if (!description.featureFlag && handle.featureFlag) {
      description.featureFlag = handle.featureFlag;
      description.resourceName = handle.resourceName || null;
    }
    // Admin auth wins when an endpoint carries both — it is the stricter gate.
    if (handle.authKind && (!description.authKind || handle.authKind === "admin")) {
      description.authKind = handle.authKind;
    }
    if (!description.rateLimit && handle.rateLimitType) {
      description.rateLimit = handle.rateLimitType;
    }
  }

  return description;
}

/**
 * Map every route object defined in a directory of `*.route.js` modules to the
 * module it came from, so operations can be tagged by subsystem.
 *
 * Identity-based rather than path-based: `require` is cached, so the route
 * objects reached here are the very same objects the composed router holds.
 * That sidesteps having to re-derive mount prefixes a second time.
 *
 * @returns {Map<object, string>} route object -> module basename (no extension)
 */
function attributeRoutesToModules(directory, extraModules = []) {
  const attribution = new Map();

  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".route.js"))
    .map((file) => path.join(directory, file));

  for (const file of [...files, ...extraModules]) {
    let router;
    try {
      router = require(file);
    } catch {
      // Matches the defensive loading in routes/v1/index.js: a subsystem that
      // cannot load is absent from the composed router too, so it simply has
      // nothing to attribute.
      continue;
    }
    if (!isRouter(router)) continue;

    const key = path.basename(file).replace(/\.route\.js$/, "");
    for (const operation of collectOperations(router)) {
      attribution.set(operation.route, key);
    }
  }

  return attribution;
}

module.exports = {
  HTTP_METHODS,
  collectOperations,
  toOpenApiPath,
  pathParameters,
  describeMiddleware,
  attributeRoutesToModules,
  mountPrefix,
};
