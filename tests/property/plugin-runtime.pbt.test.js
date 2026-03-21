import { describe, test, expect } from "vitest";
import fc from "fast-check";
import pluginRuntime from "../../modules/plugin-runtime/index.js";

const { _isObject, _resolveEnabled, _resolveConfig, _isAutoDiscoverable, _loadManifest, _loadPluginManifest } = pluginRuntime;

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

  test("_resolveEnabled precedence global > local > pluginDef > default", () => {
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

    expect(_resolveEnabled({}, {}, {})).toBe(true);
  });

  test("_resolveConfig merges shallowly with correct precedence", () => {
    const merged = _resolveConfig({ config: { a: 1, b: 1 } }, { config: { b: 2, c: 2 } }, { config: { c: 3, d: 3 } });

    expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 3 });
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
