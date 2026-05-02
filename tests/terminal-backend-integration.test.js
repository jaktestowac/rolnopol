import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ORIGINAL_ENV = { ...process.env };
let app;

beforeAll(async () => {
  vi.resetModules();
  process.env.CHATBOT_LLM_PROVIDER = "mock";
  process.env.LLM_CONSOLE_LOG_LEVEL = "0";

  const appModule = await import("../api/index.js");
  app = appModule.default || appModule;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("terminal backend integration", () => {
  it("returns terminal command metadata", async () => {
    const res = await request(app).get("/api/v1/terminal/commands").expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.commands)).toBe(true);
    expect(res.body.data.commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(["run", "open", "list", "inspect", "search", "mission", "login", "sync", "porky"]),
    );
  });

  it("starts, continues, and ends a Porky conversation", async () => {
    const sessionId = "porky-session-1";

    const startRes = await request(app)
      .post("/api/v1/terminal/porky/start")
      .send({
        sessionId,
        context: {
          terminal: {
            theme: "green",
            currentPath: "/operator/terminal.html",
          },
        },
      })
      .expect(200);

    expect(startRes.body.success).toBe(true);
    expect(startRes.body.data.active).toBe(true);
    expect(startRes.body.data.sessionId).toBe(sessionId);
    expect(startRes.body.data.reply).toContain("Porky");

    const statusRes = await request(app)
      .post("/api/v1/terminal/porky/status")
      .send({
        sessionId,
        context: {
          terminal: {
            theme: "green",
            currentPath: "/operator/terminal.html",
          },
        },
      })
      .expect(200);

    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.data.sessionId).toBe(sessionId);
    expect(statusRes.body.data.status).toMatchObject({
      sessionId,
      estimatedTokenLimit: expect.any(Number),
      estimatedTokenUsage: expect.any(Number),
    });
    expect(statusRes.body.data.reply).toContain("Porky status:");

    const messageRes = await request(app)
      .post("/api/v1/terminal/porky/message")
      .send({
        sessionId,
        message: "what is this place?",
        context: {
          terminal: {
            theme: "green",
            currentPath: "/operator/terminal.html",
          },
        },
      })
      .expect(200);

    expect(messageRes.body.success).toBe(true);
    expect(messageRes.body.data.active).toBe(true);
    expect(messageRes.body.data.sessionId).toBe(sessionId);
    expect(messageRes.body.data.reply).toEqual(expect.any(String));
    expect(messageRes.body.data.reply.length).toBeGreaterThan(0);

    const endRes = await request(app)
      .post("/api/v1/terminal/porky/end")
      .send({
        sessionId,
        context: {
          terminal: {
            theme: "green",
            currentPath: "/operator/terminal.html",
          },
        },
      })
      .expect(200);

    expect(endRes.body.success).toBe(true);
    expect(endRes.body.data.active).toBe(false);
    expect(endRes.body.data.sessionId).toBe(sessionId);
    expect(endRes.body.data.reply).toContain("Porky");
  });

  it("executes a backend script command", async () => {
    const res = await request(app)
      .post("/api/v1/terminal/execute")
      .send({ input: "run boot-sequence", sessionId: "test-session" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.commandName).toBe("run");
    expect(res.body.data.result.type).toBe("script");
    expect(res.body.data.result.id).toBe("boot-sequence");
    expect(Array.isArray(res.body.data.result.items)).toBe(true);
  });

  it("serves terminal scripts, assets, and files", async () => {
    const scriptRes = await request(app).get("/api/v1/terminal/scripts/boot-sequence").expect(200);
    const assetRes = await request(app).get("/api/v1/terminal/assets/signal-image").expect(200);
    const fileRes = await request(app).get("/api/v1/terminal/files/logs/system.log").expect(200);

    expect(scriptRes.body.success).toBe(true);
    expect(scriptRes.body.data.id).toBe("boot-sequence");
    expect(scriptRes.body.data.type).toBe("script");

    expect(assetRes.body.success).toBe(true);
    expect(assetRes.body.data.id).toBe("signal-image");
    expect(assetRes.body.data.type).toBe("image");

    expect(fileRes.body.success).toBe(true);
    expect(fileRes.body.data.path).toBe("logs/system.log");
    expect(fileRes.body.data.type).toBe("text");
  });
});
