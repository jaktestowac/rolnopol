import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Module from "module";
import path from "path";

const ROUTES_V1_INDEX_SUFFIX = path.join("routes", "v1", "index.js");

function createModuleNotFound(request) {
  const error = new Error(`Cannot find module '${request}'`);
  error.code = "MODULE_NOT_FOUND";
  return error;
}

async function withBrokenImports(brokenImports, runAssertions) {
  vi.resetModules();

  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    const parentFilename = parent?.filename || parent?.id || "";
    const shouldBreak = brokenImports.some((rule) => {
      if (request !== rule.request) {
        return false;
      }

      if (!rule.parentSuffix) {
        return true;
      }

      return parentFilename.endsWith(rule.parentSuffix);
    });

    if (shouldBreak) {
      throw createModuleNotFound(request);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  try {
    const appModule = await import("../api/index.js");
    const app = appModule.default || appModule;
    await runAssertions(app);
  } finally {
    Module._resolveFilename = originalResolveFilename;
    vi.resetModules();
  }
}

async function expectCoreStartupRoutes(app) {
  const api = await request(app).get("/api").expect(200);
  expect(api.body).toBeTruthy();

  const health = await request(app).get("/api/v1").expect(200);
  expect(health.body?.success).toBe(true);
}

describe("application startup with broken imports", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("still loads the main app when @grpc packages cannot be resolved", async () => {
    await withBrokenImports([{ request: "@grpc/grpc-js" }, { request: "@grpc/proto-loader" }], async (app) => {
      await expectCoreStartupRoutes(app);

      await request(app).get("/api/v1/greenhouse").set("x-greenhouse-demo-id", "demo-grpc1234").expect(404);
      await request(app).get("/api/v1/tasklab/tasks").expect(404);
    });
  }, 15000);

  it("still loads the main app when only @grpc/proto-loader cannot be resolved", async () => {
    await withBrokenImports([{ request: "@grpc/proto-loader" }], async (app) => {
      await expectCoreStartupRoutes(app);

      await request(app).get("/api/v1/greenhouse").set("x-greenhouse-demo-id", "demo-grpc1234").expect(404);
      await request(app).get("/api/v1/tasklab/tasks").expect(404);
    });
  }, 15000);

  it("still loads the main app when greenhouse websocket service cannot be resolved", async () => {
    await withBrokenImports([{ request: "../services/greenhouse-ws.service" }], async (app) => {
      await expectCoreStartupRoutes(app);

      await request(app).get("/api/v1/greenhouse").set("x-greenhouse-demo-id", "demo-no-ws1234").expect(404);
    });
  }, 15000);

  it("still loads the main app when greenhouse and tasklab route modules cannot be resolved", async () => {
    await withBrokenImports(
      [
        { request: "./greenhouse.route", parentSuffix: ROUTES_V1_INDEX_SUFFIX },
        { request: "./tasklab.route", parentSuffix: ROUTES_V1_INDEX_SUFFIX },
      ],
      async (app) => {
        await expectCoreStartupRoutes(app);

        await request(app).get("/api/v1/greenhouse").set("x-greenhouse-demo-id", "demo-route1234").expect(404);
        await request(app).get("/api/v1/tasklab/tasks").expect(404);
      },
    );
  }, 15000);
});
