import { describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Static terminal prototype", () => {
  it("serves the new terminal page", async () => {
    const res = await request(app).get("/operator/terminal.html").expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Archive Terminal");
    expect(res.text).toContain("/css/pages/terminal.css");
    expect(res.text).toContain("/js/pages/terminal-api-client.js");
    expect(res.text).toContain("/js/pages/terminal-theme-manager.js");
    expect(res.text).toContain("/js/pages/terminal-command-system.js");
    expect(res.text).toContain("/js/pages/terminal-output-renderer.js");
    expect(res.text).toContain("/js/pages/terminal-page.js");
    expect(res.text).toContain("terminalSuggestions");
  });

  it("redirects the shortcut path to the terminal page", async () => {
    const res = await request(app).get("/operator/terminal").expect(302);

    expect(res.headers.location).toBe("/operator/terminal.html");
  });

  it("exposes terminal metadata via the backend route", async () => {
    const res = await request(app).get("/api/v1/terminal").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      pageUrl: "/operator/terminal.html",
      prompt: "guest@archive:~$",
      prototype: true,
    });
  });

  it("exposes a static boot sequence payload", async () => {
    const res = await request(app).get("/api/v1/terminal/bootstrap").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: "static-terminal-bootstrap",
      title: "Static Terminal Bootstrap",
    });
    expect(Array.isArray(res.body.data.steps)).toBe(true);
    expect(res.body.data.steps.length).toBeGreaterThan(0);
  });
});
