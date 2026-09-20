import { describe, it, expect } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

// The page is hidden (nothing links to it) and localhost-gated the same way the
// endpoint is: a caller who could never use it gets the HTML 404 rather than a
// 403, so the console is indistinguishable from a page that does not exist.
describe("hidden operator shutdown console", () => {
  it("serves the console to a localhost caller", async () => {
    const res = await request(app).get("/operator/shutdown.html");

    expect(res.status, `Console should be served over loopback. Body: ${res.text?.slice(0, 200)}`).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Emergency Shutdown");
    expect(res.text).toContain("/js/pages/shutdown-page.js");
  });

  it("redirects the extension-less path", async () => {
    const res = await request(app).get("/operator/shutdown");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/operator/shutdown.html");
  });

  it("404s a proxied request instead of admitting the page exists", async () => {
    const res = await request(app).get("/operator/shutdown.html").set("X-Forwarded-For", "203.0.113.7");

    expect(res.status).toBe(404);
    expect(res.text, "must not leak the console markup").not.toContain("Emergency Shutdown");
  });

  it("404s the extension-less path for a proxied request too", async () => {
    const res = await request(app).get("/operator/shutdown").set("X-Forwarded-For", "203.0.113.7");

    // A 302 here would confirm the page exists — the gate has to come first.
    expect(res.status).toBe(404);
  });

  it("is linked from the backend tools page", async () => {
    const res = await request(app).get("/backend.html");

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/operator/shutdown"');
    expect(res.text).toContain("Emergency Shutdown");
    // The card must say it only works on localhost, and must be able to
    // deactivate itself when the page was opened from anywhere else.
    expect(res.text).toContain("localhost only");
    expect(res.text).toContain("backendShutdownCard");
  });

  it("serves the stylesheet and script the page needs", async () => {
    const css = await request(app).get("/css/pages/shutdown.css");
    const js = await request(app).get("/js/pages/shutdown-page.js");

    expect(css.status).toBe(200);
    expect(js.status).toBe(200);
    expect(js.text).toContain("/api/v1/shutdown");
  });
});
