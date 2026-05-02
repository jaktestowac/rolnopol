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

  it("lists a realistic virtual filesystem", async () => {
    const res = await request(app).post("/api/v1/terminal/execute").send({ input: "ls", sessionId: "fs-session-1" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.result.type).toBe("text");
    expect(res.body.data.result.content).toContain("configs/");
    expect(res.body.data.result.content).toContain("docs/");
    expect(res.body.data.result.content).toContain("logs/");
    expect(res.body.data.result.content).toContain("projects/");
    expect(res.body.data.result.content).toContain("tmp/");
  });

  it("supports cd, pwd, and tree navigation", async () => {
    const sessionId = "fs-session-2";

    const cdRes = await request(app).post("/api/v1/terminal/execute").send({ input: "cd docs", sessionId }).expect(200);

    expect(cdRes.body.success).toBe(true);
    expect(cdRes.body.data.result.metadata.path).toBe("/docs");

    const pwdRes = await request(app).post("/api/v1/terminal/execute").send({ input: "pwd", sessionId }).expect(200);

    expect(pwdRes.body.success).toBe(true);
    expect(pwdRes.body.data.result.content).toBe("/docs");

    const treeRes = await request(app).post("/api/v1/terminal/execute").send({ input: "tree /docs --depth 2", sessionId }).expect(200);

    expect(treeRes.body.success).toBe(true);
    expect(treeRes.body.data.result.content).toContain("docs/readme.md");
    expect(treeRes.body.data.result.content).toContain("docs/guide/filesystem.md");
  });

  it("rejects cd into a file path", async () => {
    const res = await request(app)
      .post("/api/v1/terminal/execute")
      .send({ input: "cd docs/readme.md", sessionId: "fs-session-3" })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_A_DIRECTORY");
  });

  it("reloads terminal data from disk through sync", async () => {
    const res = await request(app).post("/api/v1/terminal/sync").send({}).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.synced).toBe(true);
    expect(Array.isArray(res.body.data.scripts)).toBe(true);
    expect(Array.isArray(res.body.data.files)).toBe(true);
    expect(res.body.data.scripts.map((script) => script.id)).toContain("boot-sequence");
    expect(res.body.data.files.map((file) => file.path)).toContain("docs/readme.md");
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
