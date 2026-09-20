import { describe, it, expect } from "vitest";

// The list of dependencies whose absence must not abort startup
// (helpers/optional-dependencies.js).
//
// Fifteen lines, and worth testing for one reason: the file has two consumers that
// each enforce a different consequence, and both read it by name. `api/index.js`
// checks it BEFORE the dependency check runs, and `helpers/healthcheck.js` reads it
// to decide whether a missing package is a warning or a fatal. Get an entry's
// spelling wrong and a missing gRPC package stops being optional — the app refuses
// to boot over a feature that is switched off by default.
//
// The docblock also states a hard constraint: this module must stay dependency-free,
// because it loads before anything else is guaranteed installed. That is checked
// here as source text, since a `require` added later would only fail on a machine
// with an incomplete `node_modules` — i.e. never on the machine that added it.
const fs = require("fs");
const path = require("path");

const { OPTIONAL_STARTUP_DEPENDENCIES } = require("../../helpers/optional-dependencies");

const MODULE_PATH = path.join(__dirname, "..", "..", "helpers", "optional-dependencies.js");
const SOURCE = fs.readFileSync(MODULE_PATH, "utf8");
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));

describe("optional-dependencies helper", () => {
  it("exports a Set, so a lookup is a membership test rather than an array scan", () => {
    expect(OPTIONAL_STARTUP_DEPENDENCIES).toBeInstanceOf(Set);
    expect(OPTIONAL_STARTUP_DEPENDENCIES.size).toBeGreaterThan(0);
  });

  it("lists the two gRPC packages the Greenhouse and TaskLab integrations degrade without", () => {
    expect([...OPTIONAL_STARTUP_DEPENDENCIES].sort()).toEqual(["@grpc/grpc-js", "@grpc/proto-loader"]);
  });

  it("spells every entry exactly as package.json does, so a lookup by name can match", () => {
    const declared = new Set([...Object.keys(PACKAGE_JSON.dependencies || {}), ...Object.keys(PACKAGE_JSON.devDependencies || {})]);

    for (const name of OPTIONAL_STARTUP_DEPENDENCIES) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it("holds only non-empty strings — a stray object would silently never match", () => {
    for (const name of OPTIONAL_STARTUP_DEPENDENCIES) {
      expect(typeof name).toBe("string");
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("names no package the app cannot actually run without", () => {
    // Express and jsonwebtoken are load-bearing: marking one optional would turn a
    // broken install into a silent half-start.
    for (const essential of ["express", "jsonwebtoken", "dotenv"]) {
      expect(OPTIONAL_STARTUP_DEPENDENCIES.has(essential)).toBe(false);
    }
  });

  it("stays dependency-free, because it loads before the dependency check", () => {
    expect(SOURCE).not.toMatch(/\brequire\s*\(/);
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
  });

  it("is the same Set on every require, so two consumers cannot disagree", () => {
    const again = require("../../helpers/optional-dependencies");

    expect(again.OPTIONAL_STARTUP_DEPENDENCIES).toBe(OPTIONAL_STARTUP_DEPENDENCIES);
  });
});
