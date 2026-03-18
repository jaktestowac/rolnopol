import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";

const runtimeModulePath = "../../modules/plugin-runtime";

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writePlugin(dirPath, pluginSource) {
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, "index.js"), pluginSource, "utf8");
}

describe("plugin-runtime local manifests", () => {
  let tempRoot;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rolnopol-plugin-runtime-"));
    delete global.__pluginRuntimeTestCapture;
  });

  afterEach(async () => {
    vi.resetModules();
    delete global.__pluginRuntimeTestCapture;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses global manifest enabled over local manifest and plugin defaults", async () => {
    const pluginsDir = path.join(tempRoot, "plugins");
    const pluginName = "priority-plugin";
    const pluginDir = path.join(pluginsDir, pluginName);

    await writePlugin(pluginDir, `module.exports = {\n  name: "${pluginName}",\n  enabled: true\n};\n`);

    await writeJson(path.join(pluginDir, "plugin.manifest.json"), {
      enabled: true,
    });

    await writeJson(path.join(pluginsDir, "plugins.manifest.json"), {
      plugins: {
        [pluginName]: {
          enabled: false,
        },
      },
    });

    const pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir });

    const plugin = pluginRuntime.getPlugins().find((item) => item.name === pluginName);
    expect(plugin).toBeTruthy();
    expect(plugin.enabled).toBe(false);
  });

  it("uses local manifest enabled when global manifest does not define plugin", async () => {
    const pluginsDir = path.join(tempRoot, "plugins");
    const pluginName = "local-priority-plugin";
    const pluginDir = path.join(pluginsDir, pluginName);

    await writePlugin(pluginDir, `module.exports = {\n  name: "${pluginName}",\n  enabled: false\n};\n`);

    await writeJson(path.join(pluginDir, "plugin.manifest.json"), {
      autoDiscoverable: true,
      enabled: true,
    });

    await writeJson(path.join(pluginsDir, "plugins.manifest.json"), {
      plugins: {},
    });

    const pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir });

    const plugin = pluginRuntime.getPlugins().find((item) => item.name === pluginName);
    expect(plugin).toBeTruthy();
    expect(plugin.enabled).toBe(true);
  });

  it("skips plugin not listed in global manifest when autoDiscoverable is missing", async () => {
    const pluginsDir = path.join(tempRoot, "plugins");
    const pluginName = "not-registered-plugin";
    const pluginDir = path.join(pluginsDir, pluginName);

    await writePlugin(pluginDir, `module.exports = {\n  name: "${pluginName}",\n  enabled: true\n};\n`);

    await writeJson(path.join(pluginsDir, "plugins.manifest.json"), {
      plugins: {},
    });

    const pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir });

    const plugin = pluginRuntime.getPlugins().find((item) => item.name === pluginName);
    expect(plugin).toBeUndefined();
  });

  it("merges config with precedence code < local < global", async () => {
    const pluginsDir = path.join(tempRoot, "plugins");
    const pluginName = "config-precedence-plugin";
    const pluginDir = path.join(pluginsDir, pluginName);

    await writePlugin(
      pluginDir,
      `module.exports = {\n  name: "${pluginName}",\n  enabled: true,\n  config: { fromCode: 1, shared: "code" },\n  init: ({ config }) => {\n    global.__pluginRuntimeTestCapture = config;\n  }\n};\n`,
    );

    await writeJson(path.join(pluginDir, "plugin.manifest.json"), {
      config: {
        fromLocal: 1,
        shared: "local",
      },
    });

    await writeJson(path.join(pluginsDir, "plugins.manifest.json"), {
      plugins: {
        [pluginName]: {
          config: {
            fromGlobal: 1,
            shared: "global",
          },
        },
      },
    });

    const pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir });

    expect(global.__pluginRuntimeTestCapture).toEqual({
      fromCode: 1,
      fromLocal: 1,
      fromGlobal: 1,
      shared: "global",
    });
  });
});
