/**
 * Configuration for build/generate-openapi.js.
 *
 * The generator derives paths, auth, feature-flag gating and throttling by
 * introspecting the live Express routers, so this file only holds the things
 * that cannot be read out of the code: prose, naming, and the handful of
 * endpoints that live outside the version prefix.
 */

const packageJson = require("../package.json");

const CONTACT = {
  name: "API Support",
  url: "https://github.com/jaktestowac/rolnopol",
};

// OAS 3 does not allow a bare `author` key on the Info Object — only title,
// description, termsOfService, contact, license, version and `x-` extensions.
// The legacy openapi.json carries one anyway; the generated documents express
// the same thing through a specification extension so they stay valid.
const AUTHOR = "jaktestowac.pl";

/**
 * One emitted document per API version. `routerModule` is walked to discover
 * operations; `server` becomes the document's single `servers` entry.
 *
 * Two versions, two documents — deliberately not one document with two servers.
 * `servers` in OpenAPI means "the same API at several base URLs", which is not
 * what v1 and v2 are: v2 implements 2 of v1's 328 operations.
 */
const VERSIONS = [
  {
    key: "v1",
    routerModule: "routes/v1",
    outFile: "openapi.v1.json",
    server: { url: "/api/v1", description: "API v1 (stable)" },
    swaggerName: "Rolnopol API v1 (stable)",
    info: {
      title: "Rolnopol API v1",
      version: packageJson.version,
      description:
        "Stable production API for the Rolnopol service.\n\n" +
        "**Generated** from the live Express router by `npm run schema:generate` — do not edit by hand.\n\n" +
        "Operations marked with `x-feature-flag` are gated: they answer **404** while their flag is off. " +
        "Flags are listed at `GET /api/v1/feature-flags` and toggled via `PATCH /api/v1/admin/feature-flags`.",
      contact: CONTACT,
      "x-author": AUTHOR,
    },
  },
  {
    key: "v2",
    routerModule: "routes/v2",
    outFile: "openapi.v2.json",
    server: { url: "/api/v2", description: "API v2 (development)" },
    swaggerName: "Rolnopol API v2 (development)",
    info: {
      title: "Rolnopol API v2",
      version: "2.0.0",
      description:
        "Development API version. **Unstable — use v1 for production.**\n\n" +
        "v2 currently implements only the operations listed below. Everything else lives in the " +
        "v1 document (switch with the API definition picker under the title); v2 does not proxy or inherit v1.",
      contact: CONTACT,
      "x-author": AUTHOR,
    },
  },
];

/**
 * Endpoints mounted in api/index.js outside the `/api/v{n}` prefix. They are
 * emitted into the v1 document with an operation-level `servers` override
 * (legal in OAS 3.0) so that the two-document model holds without inventing a
 * third definition for five endpoints.
 */
const UNVERSIONED = {
  server: { url: "/api", description: "Platform endpoints (not version-scoped)" },
  tag: "Platform",
  // Walked from their routers, so they stay in sync automatically.
  routers: [
    { module: "routes/logs.route", mount: "/logs" },
    { module: "routes/debug.route", mount: "" },
    { module: "routes/crew-graphql.route", mount: "/graphql" },
  ],
  // Declared inline in api/index.js rather than in a router module, so they
  // cannot be introspected. The contract test asserts these still exist.
  literals: [
    {
      method: "get",
      path: "/version",
      summary: "Application version",
      responses: {
        200: {
          description: "Current application version",
          content: {
            "application/json": {
              schema: { type: "object", properties: { version: { type: "string", example: packageJson.version } } },
            },
          },
        },
      },
    },
    {
      method: "get",
      path: "/notfound-stats",
      summary: "Counters for unmatched HTML and API requests",
      responses: { 200: { description: "404 statistics grouped by html/api" } },
    },
  ],
};

/**
 * Display names for tags derived from route filenames. Anything absent falls
 * back to Title Case of the kebab-cased filename.
 */
const TAG_NAMES = {
  index: "General",
  fd: "Farm Defence",
  "agri-academy": "Agri Academy",
  "agri-academy-admin": "Agri Academy (Authoring)",
  tasklab: "TaskLab",
  crew: "Crew Office",
  "two-factor": "Two-Factor Auth",
  "personal-api-keys": "Personal API Keys",
  "farmer-tape-recorder": "Farmer's Tape Recorder",
  "feature-flags": "Feature Flags",
  "jar-counts": "Jar Counts",
  "notification-count": "Notifications",
  notifications: "Notifications",
  "weather-live": "Weather",
  weather: "Weather",
  "services-monitor": "Services Monitor",
  "chaos-engine": "Chaos Engine",
  "harvest-archive": "Harvest Archive",
  "farm-stay": "Farm Stay",
  healthcheck: "Health",
  blogs: "Blogs",
  auth: "Authentication",
};

const TAG_DESCRIPTIONS = {
  Authentication: "Registration, login, logout and session token lifecycle.",
  Admin: "Administrative plane — requires an admin bearer token.",
  "Feature Flags": "Read and toggle the flags that gate most subsystems below.",
  Platform: "Endpoints served at `/api` rather than under a version prefix.",
};

/** authKind tag (set in middleware/auth.middleware.js) -> OpenAPI security requirement. */
const SECURITY_BY_AUTH_KIND = {
  "user+apiKey": [{ TokenAuth: [] }, { BearerAuth: [] }, { ApiKeyAuth: [] }],
  user: [{ TokenAuth: [] }, { BearerAuth: [] }],
  admin: [{ AdminAuth: [] }],
};

module.exports = {
  VERSIONS,
  UNVERSIONED,
  TAG_NAMES,
  TAG_DESCRIPTIONS,
  SECURITY_BY_AUTH_KIND,
  OUTPUT_DIR: "public/schema",
  COMPONENTS_DIR: "schema/components",
  OVERRIDES_DIR: "schema/overrides",
  /**
   * public/schema/openapi.json is the original hand-written document, kept
   * frozen and offered in Swagger UI as a deprecated definition. The generator
   * deliberately does not own or overwrite it, and the contract test does not
   * hold it to the coverage rules the generated documents must satisfy.
   */
  FROZEN_LEGACY: "openapi.json",
};
