import { describe, it, expect } from "vitest";
const path = require("path");
const fs = require("fs");

// The FarmStay ecosystem must not depend on anything in Rolnopol. This test
// walks every .js file under external-services/farm-stay/ and asserts that no
// relative require() escapes the ecosystem root, and that no require() reaches
// into Rolnopol app directories.
const ROOT = path.join(__dirname, "..", "external-services", "farm-stay");

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
const FORBIDDEN_APP_DIRS = ["helpers", "services", "modules", "routes", "middleware", "data", "config"];

describe("farm-stay — independence from Rolnopol", () => {
  const files = jsFiles(ROOT);

  it("finds the ecosystem source files", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("no require() escapes external-services/farm-stay/", () => {
    const violations = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(REQUIRE_RE)) {
        const spec = m[2];
        if (!spec.startsWith(".")) continue; // bare specifier (node builtin / grpc / express)
        const resolved = path.resolve(path.dirname(file), spec);
        const rel = path.relative(ROOT, resolved);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          violations.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no require() targets a Rolnopol app directory by name", () => {
    const violations = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(REQUIRE_RE)) {
        const spec = m[2];
        if (!spec.startsWith(".")) continue;
        // A relative path that climbs above the ecosystem into an app dir.
        const climbs = spec.includes("../../../");
        const hitsAppDir = FORBIDDEN_APP_DIRS.some((d) => new RegExp(`(^|/)\\.\\.(/\\.\\.)*/${d}(/|$)`).test(spec));
        if (climbs && hitsAppDir) violations.push(`${path.relative(ROOT, file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("only depends on the two already-present gRPC packages + express (no new deps)", () => {
    const allowedBare = new Set(["@grpc/grpc-js", "@grpc/proto-loader", "express"]);
    const foreign = new Set();
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(REQUIRE_RE)) {
        const spec = m[2];
        if (spec.startsWith(".")) continue;
        if (spec.startsWith("node:")) continue;
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        // Node core modules are fine; flag any third-party package that isn't allow-listed.
        if (!allowedBare.has(pkg) && !isNodeBuiltin(pkg)) foreign.add(pkg);
      }
    }
    expect([...foreign]).toEqual([]);
  });
});

function isNodeBuiltin(pkg) {
  return require("module").builtinModules.includes(pkg);
}
