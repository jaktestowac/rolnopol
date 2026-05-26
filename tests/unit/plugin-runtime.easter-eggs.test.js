import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import request from "supertest";

const runtimeModulePath = "../../modules/plugin-runtime";
const realPluginsDir = path.resolve(process.cwd(), "plugins");

async function writeManifest(tempRoot, plugins) {
  const manifestPath = path.join(tempRoot, "plugins.manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify({ plugins }, null, 2)}\n`, "utf8");
  return manifestPath;
}

function buildApp(pluginRuntime) {
  const app = express();
  app.use(express.json());
  pluginRuntime.attach(app);

  app.get("/api/v1/healthcheck", (req, res) => {
    res.json({ success: true, status: "ok" });
  });

  app.get("/api/v1/ping", (req, res) => {
    res.json({ success: true, message: "pong" });
  });

  app.get("/api/v1/statistics", (req, res) => {
    res.json({
      users: 8,
      farms: 3,
      animals: 27,
      staff: 5,
    });
  });

  return app;
}

describe("plugin runtime easter egg plugins", () => {
  let tempRoot;
  let pluginRuntime;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rolnopol-plugin-easter-eggs-"));
  });

  afterEach(async () => {
    if (pluginRuntime && typeof pluginRuntime.shutdown === "function") {
      await pluginRuntime.shutdown();
    }

    vi.resetModules();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("adds the harvest moon header only when the matching query is present", async () => {
    const manifestPath = await writeManifest(tempRoot, {
      "harvest-moon-header-plugin": {
        enabled: true,
      },
    });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir: realPluginsDir,
      manifestPath,
    });

    const app = buildApp(pluginRuntime);

    const ordinary = await request(app).get("/api/v1/healthcheck").expect(200);
    expect(ordinary.headers["x-rolnopol-harvest-moon"]).toBeUndefined();

    const enchanted = await request(app).get("/api/v1/healthcheck?moon=harvest").expect(200);
    expect(enchanted.headers["x-rolnopol-harvest-moon"]).toBe("golden-fields-awake");
  });

  it("enriches ping responses with the barn whisper clue", async () => {
    const manifestPath = await writeManifest(tempRoot, {
      "barn-whisper-ping-plugin": {
        enabled: true,
      },
    });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir: realPluginsDir,
      manifestPath,
    });

    const app = buildApp(pluginRuntime);
    const res = await request(app).get("/api/v1/ping?sig=barn-whisper").expect(200);

    expect(res.body.meta?.easterEgg?.id).toBe("barn-whisper-ping");
    expect(res.body.meta?.easterEgg?.hoofbeats).toBe(7);
  });

  it("adds a constellation summary to statistics responses when activated", async () => {
    const manifestPath = await writeManifest(tempRoot, {
      "starlit-statistics-plugin": {
        enabled: true,
      },
    });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir: realPluginsDir,
      manifestPath,
    });

    const app = buildApp(pluginRuntime);
    const res = await request(app).get("/api/v1/statistics?constellation=lyra").expect(200);

    expect(res.body.meta?.easterEgg?.id).toBe("starlit-statistics");
    expect(res.body.meta?.easterEgg?.chorus).toContain("3 farms");
    expect(res.body.meta?.easterEgg?.chorus).toContain("27 animals");
  });

  it("serves the secret garden route only when the plugin is enabled", async () => {
    const manifestPath = await writeManifest(tempRoot, {
      "secret-garden-route-plugin": {
        enabled: true,
      },
    });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir: realPluginsDir,
      manifestPath,
    });

    const app = buildApp(pluginRuntime);
    const res = await request(app).get("/api/v1/easter-eggs/secret-garden").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Hidden grove unlocked");
    expect(res.body.meta?.easterEgg?.id).toBe("secret-garden-route");
  });

  it("captures notification-center events in the firefly jar", async () => {
    const manifestPath = await writeManifest(tempRoot, {
      "firefly-notification-plugin": {
        enabled: true,
      },
    });

    const handlers = [];
    const notificationCenter = {
      subscribeEvents: vi.fn((handler) => {
        handlers.push(handler);
        return () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      }),
    };

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir: realPluginsDir,
      manifestPath,
      services: {
        notificationCenter,
      },
    });

    const app = buildApp(pluginRuntime);

    handlers[0]({
      type: "user.logged-in",
      source: "tests",
      timestamp: "2026-05-26T12:00:00.000Z",
    });

    let res = await request(app).get("/api/v1/easter-eggs/firefly-jar").expect(200);
    expect(res.body.data.captured).toBe(0);
    expect(res.body.meta?.easterEgg?.glowLevel).toBe("dim");

    handlers[0]({
      type: "field.created",
      source: "tests",
      timestamp: "2026-05-26T12:05:00.000Z",
    });

    res = await request(app).get("/api/v1/easter-eggs/firefly-jar").expect(200);
    expect(res.body.data.captured).toBe(1);
    expect(res.body.data.events[0]).toMatchObject({
      type: "field.created",
      source: "tests",
    });
    expect(res.body.meta?.easterEgg?.id).toBe("firefly-notification-jar");
  });
});
