import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

const { generate, serialise } = require(path.join(ROOT, "build/generate-openapi.js"));
const { collectOperations, toOpenApiPath } = require(path.join(ROOT, "build/lib/introspect-routes.js"));
const config = require(path.join(ROOT, "schema/generator.config.js"));
const { PREDEFINED_FEATURE_FLAGS } = require(path.join(ROOT, "services/feature-flags.service.js"));

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];

/* Generating both documents walks every live router, which takes long enough
 * that repeating it per test can outrun the suite timeout on a loaded machine.
 * The generator is pure, so one run serves the whole file. */
let generated = null;
const generateOnce = () => (generated = generated || generate());

const readDocument = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, config.OUTPUT_DIR, file), "utf8"));

/** Parameter names are documentation only; compare on position. */
const shapeOf = (apiPath) => apiPath.replace(/\{[^}]+\}/g, "{}");

/** Every `METHOD /path` in a document, as position-normalised shapes. */
function documentedShapes(document, { unversioned = false } = {}) {
  const shapes = new Set();

  for (const [apiPath, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      // Operations carrying a `servers` override are the ones mounted outside
      // the version prefix; they answer to a different router.
      if (Boolean(operation.servers) !== unversioned) continue;
      shapes.add(`${method.toUpperCase()} ${shapeOf(apiPath)}`);
    }
  }

  return shapes;
}

function liveShapes(routerModule) {
  const router = require(path.join(ROOT, routerModule));
  return new Set(collectOperations(router).map((op) => `${op.method.toUpperCase()} ${shapeOf(toOpenApiPath(op.path))}`));
}

/** Walk a document collecting every `$ref` string. */
function collectRefs(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, found));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

function resolveRef(document, ref) {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .reduce((node, segment) => (node === undefined ? undefined : node[segment.replace(/~1/g, "/").replace(/~0/g, "~")]), document);
}

describe("OpenAPI contract", () => {
  describe("freshness", () => {
    it("committed documents match what the generator produces", () => {
      const { documents } = generateOnce();
      const stale = Object.entries(documents)
        .filter(([file, document]) => {
          const target = path.join(ROOT, config.OUTPUT_DIR, file);
          return !fs.existsSync(target) || fs.readFileSync(target, "utf8") !== serialise(document);
        })
        .map(([file]) => file);

      expect(stale, `Stale schema file(s). Run: npm run schema:generate`).toEqual([]);
    });

    it("reports no generator warnings that indicate a broken document", () => {
      const { warnings } = generateOnce();
      const blocking = warnings.filter((warning) => /Duplicate operation|Path collision|matches no live route|Skipped/.test(warning));
      expect(blocking, `Generator warnings:\n${blocking.join("\n")}`).toEqual([]);
    });
  });

  describe("coverage — every live route is documented", () => {
    for (const version of config.VERSIONS) {
      it(`${version.key}: no undocumented routes`, () => {
        const documented = documentedShapes(readDocument(version.outFile));
        const missing = [...liveShapes(version.routerModule)].filter((shape) => !documented.has(shape));
        expect(missing, `Routes missing from ${version.outFile}`).toEqual([]);
      });

      it(`${version.key}: no documented routes that do not exist`, () => {
        const live = liveShapes(version.routerModule);
        const ghosts = [...documentedShapes(readDocument(version.outFile))].filter((shape) => !live.has(shape));
        expect(ghosts, `Documented in ${version.outFile} but not mounted`).toEqual([]);
      });
    }

    it("unversioned endpoints match their routers", () => {
      const documented = documentedShapes(readDocument(config.VERSIONS[0].outFile), { unversioned: true });

      const live = new Set(config.UNVERSIONED.literals.map((literal) => `${literal.method.toUpperCase()} ${shapeOf(literal.path)}`));
      for (const entry of config.UNVERSIONED.routers) {
        const router = require(path.join(ROOT, entry.module));
        for (const operation of collectOperations(router)) {
          const joined = `${entry.mount}${toOpenApiPath(operation.path)}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
          live.add(`${operation.method.toUpperCase()} ${shapeOf(joined)}`);
        }
      }

      expect([...documented].sort()).toEqual([...live].sort());
    });

    it("the endpoints declared inline in api/index.js still exist", () => {
      // These cannot be introspected (they are `app.get(...)` calls in the
      // startup file), so they are declared in generator.config.js. If one is
      // renamed there is nothing but this assertion to catch the drift.
      const source = fs.readFileSync(path.join(ROOT, "api/index.js"), "utf8");
      for (const literal of config.UNVERSIONED.literals) {
        expect(source, `api/index.js no longer defines /api${literal.path}`).toContain(`"/api${literal.path}"`);
      }
    });
  });

  describe("version separation", () => {
    it("each document declares exactly one server, matching its version", () => {
      for (const version of config.VERSIONS) {
        const document = readDocument(version.outFile);
        expect(document.servers).toHaveLength(1);
        expect(document.servers[0].url).toBe(version.server.url);
      }
    });

    it("v2 documents only what v2 implements", () => {
      const v2 = readDocument(config.VERSIONS[1].outFile);
      // Guards the whole point of splitting the documents: v2 must never
      // inherit v1's surface just because the two share components.
      expect(Object.keys(v2.paths).sort()).toEqual(["/", "/healthcheck"]);
    });

    it("the generator leaves the frozen legacy document alone", () => {
      // openapi.json is the superseded hand-written schema, still offered in
      // Swagger UI as a deprecated definition. It predates the coverage rules
      // and would fail every one of them, so the only thing asserted about it
      // is that `schema:generate` never rewrites it — checked both as intent
      // (it is not among the emitted documents) and as bytes on disk.
      const legacyPath = path.join(ROOT, config.OUTPUT_DIR, config.FROZEN_LEGACY);
      const before = fs.readFileSync(legacyPath);

      const { documents } = generateOnce();
      expect(Object.keys(documents)).not.toContain(config.FROZEN_LEGACY);

      expect(fs.readFileSync(legacyPath).equals(before)).toBe(true);
    });

    it("only v1 and v2 are emitted", () => {
      const { documents } = generateOnce();
      expect(Object.keys(documents).sort()).toEqual(config.VERSIONS.map((version) => version.outFile).sort());
    });

    it("Swagger UI is wired to both definitions", () => {
      const initializer = fs.readFileSync(path.join(ROOT, "public/swagger/swagger-initializer.js"), "utf8");
      for (const version of config.VERSIONS) {
        expect(initializer).toContain(`/schema/${version.outFile}`);
      }
    });
  });

  describe("structural validity", () => {
    for (const version of config.VERSIONS) {
      it(`${version.key}: every $ref resolves`, () => {
        const document = readDocument(version.outFile);
        const broken = [...new Set(collectRefs(document))].filter((ref) => resolveRef(document, ref) === undefined);
        expect(broken).toEqual([]);
      });

      it(`${version.key}: every path parameter is declared`, () => {
        const document = readDocument(version.outFile);
        const problems = [];

        for (const [apiPath, item] of Object.entries(document.paths)) {
          const required = [...apiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);

          for (const [method, operation] of Object.entries(item)) {
            if (!HTTP_METHODS.includes(method)) continue;
            const declared = (operation.parameters || []).filter((p) => p.in === "path").map((p) => p.name);
            const missing = required.filter((name) => !declared.includes(name));
            if (missing.length) problems.push(`${method.toUpperCase()} ${apiPath} missing ${missing.join(", ")}`);
          }
        }

        expect(problems).toEqual([]);
      });

      it(`${version.key}: operationIds are unique`, () => {
        const document = readDocument(version.outFile);
        const seen = new Map();
        const duplicates = [];

        for (const [apiPath, item] of Object.entries(document.paths)) {
          for (const [method, operation] of Object.entries(item)) {
            if (!HTTP_METHODS.includes(method)) continue;
            const where = `${method.toUpperCase()} ${apiPath}`;
            if (seen.has(operation.operationId)) duplicates.push(`${operation.operationId}: ${seen.get(operation.operationId)} / ${where}`);
            seen.set(operation.operationId, where);
          }
        }

        expect(duplicates).toEqual([]);
      });

      it(`${version.key}: no two paths differ only by parameter name`, () => {
        const document = readDocument(version.outFile);
        const byShape = new Map();
        const collisions = [];

        for (const apiPath of Object.keys(document.paths)) {
          const shape = shapeOf(apiPath);
          if (byShape.has(shape)) collisions.push(`${byShape.get(shape)} / ${apiPath}`);
          byShape.set(shape, apiPath);
        }

        expect(collisions).toEqual([]);
      });

      it(`${version.key}: every operation is tagged and described`, () => {
        const document = readDocument(version.outFile);
        const declaredTags = new Set(document.tags.map((tag) => tag.name));
        const problems = [];

        for (const [apiPath, item] of Object.entries(document.paths)) {
          for (const [method, operation] of Object.entries(item)) {
            if (!HTTP_METHODS.includes(method)) continue;
            const where = `${method.toUpperCase()} ${apiPath}`;
            if (!operation.summary) problems.push(`${where}: no summary`);
            if (!operation.tags || !operation.tags.length) problems.push(`${where}: no tag`);
            else if (!declaredTags.has(operation.tags[0])) problems.push(`${where}: tag "${operation.tags[0]}" not declared`);
            if (!Object.keys(operation.responses || {}).length) problems.push(`${where}: no responses`);
          }
        }

        expect(problems).toEqual([]);
      });
    }
  });

  describe("feature flag metadata", () => {
    it("every x-feature-flag names a real flag", () => {
      const document = readDocument(config.VERSIONS[0].outFile);
      const known = new Set(Object.keys(PREDEFINED_FEATURE_FLAGS));
      const unknown = new Set();

      for (const item of Object.values(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
          if (!HTTP_METHODS.includes(method)) continue;
          const flag = operation["x-feature-flag"];
          if (flag && !known.has(flag)) unknown.add(flag);
        }
      }

      expect([...unknown]).toEqual([]);
    });

    it("gated operations document the 404 they answer while the flag is off", () => {
      const document = readDocument(config.VERSIONS[0].outFile);
      const problems = [];

      for (const [apiPath, item] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
          if (!HTTP_METHODS.includes(method) || !operation["x-feature-flag"]) continue;
          if (!operation.responses["404"]) problems.push(`${method.toUpperCase()} ${apiPath}`);
        }
      }

      expect(problems).toEqual([]);
    });
  });
});
