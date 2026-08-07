#!/usr/bin/env node
/**
 * Generates the OpenAPI documents served to Swagger UI.
 *
 *   npm run schema:generate     rewrite public/schema/*.json
 *   npm run schema:check        fail if the committed files are stale
 *
 * One document per API version. Coverage comes from walking the live Express
 * routers (see build/lib/introspect-routes.js); prose and payload schemas come
 * from schema/overrides/ and schema/components/. Nothing about the endpoint
 * list is hand-maintained, which is what keeps it from drifting again.
 */

const fs = require("fs");
const path = require("path");

const config = require("../schema/generator.config");
const {
  collectOperations,
  toOpenApiPath,
  pathParameters,
  describeMiddleware,
  attributeRoutesToModules,
} = require("./lib/introspect-routes");

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** Deep merge where the override wins and arrays are replaced wholesale. */
function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in base ? merge(base[key], value) : value;
  }
  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonDir(directory) {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return {};

  return fs
    .readdirSync(absolute)
    .filter((file) => file.endsWith(".json"))
    .reduce((accumulator, file) => merge(accumulator, JSON.parse(fs.readFileSync(path.join(absolute, file), "utf8"))), {});
}

function titleCase(kebab) {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function tagFor(moduleKey) {
  if (!moduleKey) return "General";
  return config.TAG_NAMES[moduleKey] || titleCase(moduleKey);
}

/** `get` + `/observatory/viewport` -> `getObservatoryViewport`. */
function operationIdFor(method, openApiPath) {
  const segments = openApiPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const parameter = segment.match(/^\{(.+)\}$/);
      return parameter
        ? `By${titleCase(parameter[1]).replace(/\s+/g, "")}`
        : titleCase(segment.replace(/[^A-Za-z0-9-]/g, "")).replace(/\s+/g, "");
    });

  return method + segments.join("") || method;
}

/** A readable placeholder until an override supplies a real summary. */
function summaryFor(method, openApiPath) {
  const words = openApiPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^\{(.+)\}$/, "by $1"))
    .join(" ")
    .replace(/-/g, " ");

  return `${method.toUpperCase()} ${words}`.trim();
}

// ---------------------------------------------------------------------------
// operation construction
// ---------------------------------------------------------------------------

function buildOperation({ method, openApiPath, tag, guards, serversOverride }) {
  const parameters = pathParameters(openApiPath).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
    description: `Identifier of the target ${name.replace(/Id$/, "")}.`,
  }));

  const operation = {
    tags: [tag],
    operationId: operationIdFor(method, openApiPath),
    summary: summaryFor(method, openApiPath),
    responses: {},
  };

  if (serversOverride) operation.servers = [serversOverride];
  if (parameters.length) operation.parameters = parameters;

  const notes = [];

  if (guards.authKind) {
    operation.security = config.SECURITY_BY_AUTH_KIND[guards.authKind] || [];
    operation["x-auth"] = guards.authKind;
  }

  if (guards.featureFlag) {
    operation["x-feature-flag"] = guards.featureFlag;
    notes.push(
      `**Gated by feature flag \`${guards.featureFlag}\`.** Answers \`404\` while the flag is off — ` +
        "toggle it via `PATCH /api/v1/admin/feature-flags`.",
    );
  }

  if (guards.rateLimit) {
    operation["x-rate-limit"] = guards.rateLimit;
  }

  // Success placeholder; overrides replace it with the real shape.
  operation.responses["200"] = { description: "Successful response" };

  if (guards.authKind) {
    operation.responses["401"] = { $ref: "#/components/responses/Unauthorized" };
    operation.responses["403"] = { $ref: "#/components/responses/Forbidden" };
  }

  if (guards.featureFlag) {
    operation.responses["404"] = { $ref: "#/components/responses/FeatureDisabled" };
  } else if (parameters.length) {
    operation.responses["404"] = { $ref: "#/components/responses/NotFound" };
  }

  if (guards.rateLimit) {
    operation.responses["429"] = { $ref: "#/components/responses/TooManyRequests" };
  }

  operation.responses["500"] = { $ref: "#/components/responses/InternalError" };

  if (notes.length) operation.description = notes.join("\n\n");

  return operation;
}

/**
 * Describe every operation a router exposes. Operations are *described* here
 * and *built* later, because the path parameter names have to be reconciled
 * across the whole document first (see canonicaliseParameterNames).
 */
function operationsFromRouter(router, { attribution, serversOverride, forcedTag }) {
  return collectOperations(router).map(({ method, path: expressPath, route, middleware }) => ({
    method,
    openApiPath: toOpenApiPath(expressPath),
    tag: forcedTag || tagFor(attribution && attribution.get(route)),
    guards: describeMiddleware(middleware),
    serversOverride,
  }));
}

/**
 * Give every path parameter in the same position of the same path shape one
 * name across the document.
 *
 * Express is happy for `GET /exams/:examId` and `PATCH /exams/:id` to coexist —
 * the name is local to the handler. OpenAPI is not: paths that differ only by
 * parameter name are the same path, so emitting both produces a document that
 * validators reject and Swagger UI renders twice. The name is documentation
 * only (position is what routes the request), so the majority name wins.
 */
function canonicaliseParameterNames(descriptors, warnings) {
  const namesByShape = new Map();

  for (const { openApiPath } of descriptors) {
    const shape = openApiPath.replace(/\{[^}]+\}/g, "{}");
    const names = namesByShape.get(shape) || [];
    pathParameters(openApiPath).forEach((name, index) => {
      names[index] = names[index] || new Map();
      names[index].set(name, (names[index].get(name) || 0) + 1);
    });
    namesByShape.set(shape, names);
  }

  const renames = new Set();

  for (const descriptor of descriptors) {
    const shape = descriptor.openApiPath.replace(/\{[^}]+\}/g, "{}");
    const positions = namesByShape.get(shape);
    let position = -1;

    const rewritten = descriptor.openApiPath.replace(/\{([^}]+)\}/g, (match, name) => {
      position += 1;
      const counts = positions[position];
      if (!counts || counts.size < 2) return match;

      const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (winner !== name) renames.add(`${descriptor.openApiPath} → {${winner}} (was {${name}})`);
      return `{${winner}}`;
    });

    descriptor.openApiPath = rewritten;
  }

  for (const rename of renames) {
    warnings.push(`Canonicalised path parameter: ${rename}`);
  }
}

// ---------------------------------------------------------------------------
// document assembly
// ---------------------------------------------------------------------------

function buildDocument(version, { components, overrides, warnings }) {
  const router = require(path.join(ROOT, version.routerModule));

  const attribution =
    version.key === "v1" ? attributeRoutesToModules(path.join(ROOT, "routes/v1"), [path.join(ROOT, "routes/contact.route.js")]) : new Map();

  const collected = operationsFromRouter(router, { attribution });

  if (version.key === "v1") {
    for (const entry of config.UNVERSIONED.routers) {
      let unversionedRouter;
      try {
        unversionedRouter = require(path.join(ROOT, entry.module));
      } catch (error) {
        warnings.push(`Skipped unversioned router ${entry.module}: ${error.message}`);
        continue;
      }
      const nested = operationsFromRouter(unversionedRouter, {
        attribution: new Map(),
        serversOverride: config.UNVERSIONED.server,
        forcedTag: config.UNVERSIONED.tag,
      });
      for (const item of nested) {
        item.openApiPath = toOpenApiPath(`${entry.mount}${item.openApiPath}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1"));
        collected.push(item);
      }
    }

    for (const literal of config.UNVERSIONED.literals) {
      collected.push({
        method: literal.method,
        openApiPath: literal.path,
        tag: config.UNVERSIONED.tag,
        guards: { authKind: null, featureFlag: null, rateLimit: null },
        serversOverride: config.UNVERSIONED.server,
        extra: { summary: literal.summary, responses: literal.responses },
      });
    }
  }

  canonicaliseParameterNames(collected, warnings);

  // Assemble path items, applying overrides and catching collisions.
  const paths = {};
  const seenKeys = new Set();
  const usedOperationIds = new Map();
  let enrichedCount = 0;

  const ordered = collected.sort((a, b) => a.openApiPath.localeCompare(b.openApiPath) || a.method.localeCompare(b.method));

  for (const descriptor of ordered) {
    const key = `${descriptor.method.toUpperCase()} ${descriptor.openApiPath}`;

    if (seenKeys.has(key)) {
      warnings.push(`Duplicate operation ${key} — later definition ignored.`);
      continue;
    }
    seenKeys.add(key);

    let operation = buildOperation(descriptor);
    if (descriptor.extra) operation = merge(operation, descriptor.extra);

    const override = overrides[key];
    if (override) {
      operation = merge(operation, override);
      enrichedCount += 1;
    }

    const previousKey = usedOperationIds.get(operation.operationId);
    if (previousKey && previousKey !== key) {
      warnings.push(`Duplicate operationId "${operation.operationId}" (${previousKey} and ${key}).`);
    }
    usedOperationIds.set(operation.operationId, key);

    paths[descriptor.openApiPath] = paths[descriptor.openApiPath] || {};
    paths[descriptor.openApiPath][descriptor.method] = operation;
  }

  detectPathCollisions(Object.keys(paths), warnings);

  const tags = [...new Set(Object.values(paths).flatMap((item) => Object.values(item).flatMap((operation) => operation.tags || [])))]
    .sort()
    .map((name) => (config.TAG_DESCRIPTIONS[name] ? { name, description: config.TAG_DESCRIPTIONS[name] } : { name }));

  return {
    document: {
      openapi: "3.0.3",
      info: version.info,
      servers: [version.server],
      tags,
      paths,
      components,
    },
    operationCount: seenKeys.size,
    enrichedCount,
  };
}

/**
 * OpenAPI treats paths that differ only in parameter *name* as the same path,
 * so `/tasks/{id}` and `/tasks/{taskId}` are an invalid pair even though they
 * are distinct JSON keys. Validators reject it; Swagger UI renders both.
 */
function detectPathCollisions(paths, warnings) {
  const byShape = new Map();

  for (const item of paths) {
    const shape = item.replace(/\{[^}]+\}/g, "{}");
    if (byShape.has(shape)) {
      warnings.push(`Path collision: "${byShape.get(shape)}" and "${item}" differ only by parameter name.`);
      continue;
    }
    byShape.set(shape, item);
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function generate() {
  const components = readJsonDir(config.COMPONENTS_DIR);
  const warnings = [];
  const documents = {};
  const stats = [];

  for (const version of config.VERSIONS) {
    const overrides = readJsonDir(path.join(config.OVERRIDES_DIR, version.key));
    const { document, operationCount, enrichedCount } = buildDocument(version, { components, overrides, warnings });

    documents[version.outFile] = document;
    stats.push({ version: version.key, operationCount, enrichedCount, overrides: Object.keys(overrides).length });

    // Overrides that match nothing are almost always a renamed or deleted route.
    const liveKeys = new Set(
      Object.entries(document.paths).flatMap(([p, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${p}`)),
    );
    for (const key of Object.keys(overrides)) {
      if (!liveKeys.has(key)) warnings.push(`Override "${key}" (${version.key}) matches no live route — stale?`);
    }
  }

  // config.FROZEN_LEGACY is intentionally absent from `documents` — it is the
  // superseded hand-written schema and must survive `schema:generate` untouched.

  return { documents, warnings, stats };
}

function serialise(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { documents, warnings, stats } = generate();
  const outputDir = path.join(ROOT, config.OUTPUT_DIR);

  let stale = false;

  for (const [file, document] of Object.entries(documents)) {
    const target = path.join(outputDir, file);
    const next = serialise(document);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

    if (current === next) continue;

    if (checkOnly) {
      stale = true;
      console.error(`✗ ${config.OUTPUT_DIR}/${file} is out of date`);
      continue;
    }

    fs.writeFileSync(target, next);
    console.log(`✓ wrote ${config.OUTPUT_DIR}/${file}`);
  }

  for (const item of stats) {
    console.log(`  ${item.version}: ${item.operationCount} operations · ${item.enrichedCount} enriched from ${item.overrides} overrides`);
  }

  for (const warning of warnings) console.warn(`  ! ${warning}`);

  if (checkOnly && stale) {
    console.error("\nSchema is stale. Run: npm run schema:generate");
    process.exit(1);
  }

  if (checkOnly) console.log("✓ schema is up to date");
}

if (require.main === module) {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  main();
}

module.exports = { generate, serialise, merge };
