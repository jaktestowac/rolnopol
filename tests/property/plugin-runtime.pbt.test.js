import { describe, test, expect } from "vitest";
import fc from "fast-check";
import pluginRuntime from "../../modules/plugin-runtime/index.js";

const { _isObject, _resolveEnabled, _resolveConfig, _resolveOrder, _mergeConfig, _isAutoDiscoverable, _loadManifest, _loadPluginManifest } =
  pluginRuntime;

describe("Plugin runtime internal property-based tests", () => {
  test("_isObject behaves correctly", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = _isObject(value);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
    );
  });

  test("_resolveEnabled precedence global > local > pluginDef > default-disabled", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (g, l, p) => {
        const out = _resolveEnabled({ enabled: p }, { enabled: l }, { enabled: g });
        expect(out).toBe(g);
      }),
    );

    // local when global unselected
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (l, p) => {
        const out = _resolveEnabled({ enabled: p }, { enabled: l }, {});
        expect(out).toBe(l);
      }),
    );

    fc.assert(
      fc.property(fc.boolean(), (p) => {
        const out = _resolveEnabled({ enabled: p }, {}, {});
        expect(out).toBe(p);
      }),
    );

    expect(_resolveEnabled({}, {}, {})).toBe(false);
  });

  test("_resolveConfig merges shallowly with correct precedence", () => {
    const merged = _resolveConfig({ config: { a: 1, b: 1 } }, { config: { b: 2, c: 2 } }, { config: { c: 3, d: 3 } });

    expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 3 });
  });

  test("_resolveOrder precedence global > local > pluginDef > default 1000", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (g, l, p) => {
        expect(_resolveOrder({ order: p }, { order: l }, { order: g })).toBe(g);
        expect(_resolveOrder({ order: p }, { order: l }, {})).toBe(l);
        expect(_resolveOrder({ order: p }, {}, {})).toBe(p);
      }),
    );

    expect(_resolveOrder({}, {}, {})).toBe(1000);

    // Anything that is not a finite number is not an order.
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null), fc.constant(NaN), fc.constant(Infinity)), (bad) => {
        expect(_resolveOrder({ order: 7 }, {}, { order: bad })).toBe(7);
      }),
    );
  });

  test("_mergeConfig keeps every key from both sides, with the override winning", () => {
    // Config is read from JSON manifests, so a key that reshapes the object rather than
    // filling it is reachable by anyone who can write one. Those are dropped.
    const UNSAFE = ["__proto__", "constructor", "prototype"];

    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer()), fc.dictionary(fc.string(), fc.integer()), (base, override) => {
        const merged = _mergeConfig(base, override);

        for (const key of Object.keys(base)) {
          if (UNSAFE.includes(key)) continue;
          expect(Object.prototype.hasOwnProperty.call(merged, key)).toBe(true);
        }
        for (const [key, value] of Object.entries(override)) {
          if (UNSAFE.includes(key)) continue;
          expect(merged[key]).toBe(value);
        }
      }),
    );
  });

  test("_mergeConfig cannot be used to reshape the object it returns", () => {
    const polluted = _mergeConfig({ safe: 1 }, JSON.parse('{ "__proto__": { "injected": true }, "also": 2 }'));

    expect(polluted).toEqual({ safe: 1, also: 2 });
    expect(Object.prototype.hasOwnProperty.call(polluted, "__proto__")).toBe(false);
    expect(polluted.injected).toBeUndefined();
    expect({}.injected).toBeUndefined();

    // An inherited name is not a reason to recurse into Object.prototype either.
    expect(_mergeConfig({}, { constructor: { nope: true } })).toEqual({});
  });

  test("_mergeConfig merges nested objects and replaces arrays whole", () => {
    const merged = _mergeConfig({ limits: { soft: 1, hard: 2 }, tags: ["a", "b"] }, { limits: { hard: 99 }, tags: ["c"] });

    expect(merged).toEqual({ limits: { soft: 1, hard: 99 }, tags: ["c"] });

    // A scalar on either side replaces rather than merges, in both directions.
    expect(_mergeConfig({ a: { deep: true } }, { a: 5 })).toEqual({ a: 5 });
    expect(_mergeConfig({ a: 5 }, { a: { deep: true } })).toEqual({ a: { deep: true } });
    expect(_mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  test("_isAutoDiscoverable priority and boolean rules", () => {
    expect(_isAutoDiscoverable({ autoDiscoverable: false }, { autoDiscoverable: true })).toBe(true);
    expect(_isAutoDiscoverable({ autoDiscoverable: true }, {})).toBe(true);
    expect(_isAutoDiscoverable({}, {})).toBe(false);
  });

  test("_loadManifest handles missing or invalid files safely", async () => {
    const tmpPath = "tests/property/tmp-manifest.json";
    try {
      // Non-existent file
      const missing = _loadManifest("non-existent-file.json");
      expect(missing).toEqual({ plugins: {} });

      // Invalid JSON file
      await import("fs/promises").then(async (fsPromises) => {
        await fsPromises.writeFile(tmpPath, "not-json", "utf8");
      });
      const invalid = _loadManifest(tmpPath);
      expect(invalid).toEqual({ plugins: {} });

      // Valid manifest
      await import("fs/promises").then(async (fsPromises) => {
        await fsPromises.writeFile(tmpPath, JSON.stringify({ plugins: { p1: { enabled: false } } }), "utf8");
      });
      const valid = _loadManifest(tmpPath);
      expect(valid).toEqual({ plugins: { p1: { enabled: false } } });
    } finally {
      await import("fs/promises").then(async (fsPromises) => {
        if (
          await fsPromises
            .access(tmpPath)
            .then(() => true)
            .catch(() => false)
        ) {
          await fsPromises.unlink(tmpPath);
        }
      });
    }
  });

  test("_loadPluginManifest handles missing and invalid files", async () => {
    const tmpPath = "tests/property/tmp-plugin-manifest.json";
    try {
      const missing = _loadPluginManifest("non-existent-file.json");
      expect(missing).toEqual({});

      await import("fs/promises").then(async (fsPromises) => {
        await fsPromises.writeFile(tmpPath, "not-json", "utf8");
      });
      const invalid = _loadPluginManifest(tmpPath);
      expect(invalid).toEqual({});

      await import("fs/promises").then(async (fsPromises) => {
        await fsPromises.writeFile(tmpPath, JSON.stringify({ enabled: true }), "utf8");
      });
      const valid = _loadPluginManifest(tmpPath);
      expect(valid).toEqual({ enabled: true });
    } finally {
      await import("fs/promises").then(async (fsPromises) => {
        if (
          await fsPromises
            .access(tmpPath)
            .then(() => true)
            .catch(() => false)
        ) {
          await fsPromises.unlink(tmpPath);
        }
      });
    }
  });
});
