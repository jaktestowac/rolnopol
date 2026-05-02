import { describe, expect, it, vi } from "vitest";

const { TerminalApiError, createTerminalApiClient } = require("../../public/js/pages/terminal-api-client.js");

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get: (name) => (String(name).toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
  };
}

describe("terminal api client", () => {
  it("requests terminal metadata and command execution payloads", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (String(url).includes("/terminal/commands")) {
        expect(options.method).toBe("GET");
        return createJsonResponse(200, {
          success: true,
          data: {
            commands: [{ name: "run" }],
          },
        });
      }

      if (String(url).includes("/terminal/execute")) {
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.input).toBe("login");
        expect(body.sessionId).toBe("session-123");
        return createJsonResponse(200, {
          success: true,
          data: {
            ok: true,
            result: {
              type: "text",
              content: "done",
            },
          },
        });
      }

      if (String(url).includes("/terminal/porky/start")) {
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.sessionId).toBe("session-123");
        return createJsonResponse(200, {
          success: true,
          data: {
            sessionId: "session-123",
            active: true,
            reply: "Porky wakes up.",
          },
        });
      }

      if (String(url).includes("/terminal/porky/message")) {
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.message).toBe("what is this place?");
        expect(body.sessionId).toBe("session-123");
        return createJsonResponse(200, {
          success: true,
          data: {
            sessionId: "session-123",
            active: true,
            reply: "An archive. Or what remains of one.",
          },
        });
      }

      if (String(url).includes("/terminal/porky/status")) {
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.sessionId).toBe("session-123");
        return createJsonResponse(200, {
          success: true,
          data: {
            sessionId: "session-123",
            active: true,
            reply: "Porky status:\nprovider: mock",
            status: {
              sessionId: "session-123",
              provider: "mock",
              model: "mock",
              estimatedTokenUsage: 12,
              estimatedTokenLimit: 2400,
            },
          },
        });
      }

      if (String(url).includes("/terminal/porky/end")) {
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.sessionId).toBe("session-123");
        return createJsonResponse(200, {
          success: true,
          data: {
            sessionId: "session-123",
            active: false,
            reply: "Porky slips away.",
          },
        });
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const client = createTerminalApiClient({
      baseUrl: "http://example.test",
      sessionId: "session-123",
      fetchImpl,
    });

    await expect(client.getCommands()).resolves.toEqual({ commands: [{ name: "run" }] });
    await expect(client.executeCommand("login")).resolves.toEqual({
      ok: true,
      result: {
        type: "text",
        content: "done",
      },
    });
    await expect(client.startPorkyConversation()).resolves.toMatchObject({
      sessionId: "session-123",
      active: true,
      reply: "Porky wakes up.",
    });
    await expect(client.sendPorkyMessage("what is this place?")).resolves.toMatchObject({
      sessionId: "session-123",
      active: true,
      reply: "An archive. Or what remains of one.",
    });
    await expect(client.getPorkyStatus()).resolves.toMatchObject({
      sessionId: "session-123",
      active: true,
      reply: "Porky status:\nprovider: mock",
    });
    await expect(client.endPorkyConversation()).resolves.toMatchObject({
      sessionId: "session-123",
      active: false,
      reply: "Porky slips away.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("surfaces structured backend errors", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse(404, {
        success: false,
        error: {
          code: "SCRIPT_NOT_FOUND",
          message: "Unknown script: missing",
          hint: 'Try "list scripts" to see available scripts.',
        },
      }),
    );

    const client = createTerminalApiClient({
      baseUrl: "http://example.test",
      fetchImpl,
    });

    await expect(client.getScript("missing")).rejects.toMatchObject({
      name: "TerminalApiError",
      message: "Unknown script: missing",
      code: "SCRIPT_NOT_FOUND",
      status: 404,
      hint: 'Try "list scripts" to see available scripts.',
    });
  });

  it("formats api errors as terminal command results", () => {
    const error = new TerminalApiError("Backend offline", {
      status: 503,
      code: "BACKEND_OFFLINE",
      hint: 'Try "help" to see available commands.',
    });

    expect(error.toCommandResult()).toEqual({
      type: "error",
      content: "Backend offline",
      metadata: {
        code: "BACKEND_OFFLINE",
        status: 503,
        hint: 'Try "help" to see available commands.',
      },
    });
  });
});
