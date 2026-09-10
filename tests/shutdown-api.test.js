import { describe, it, expect } from "vitest";
import request from "supertest";

// Import the app without starting the server
const app = require("../api/index.js");

// NOTE: supertest dials the app over loopback, so these requests pass the
// localhost gate. They are safe only because the endpoint skips the teardown
// under NODE_ENV=test (which tests/setup.js and the npm scripts guarantee) —
// otherwise this file would kill the test runner. The teardown itself is covered
// by tests/unit/app-shutdown.service.test.js.
describe("GET /api/v1/shutdown", () => {
  it("accepts a localhost request and reports a simulated shutdown under NODE_ENV=test", async () => {
    expect(process.env.NODE_ENV, "this suite must run with NODE_ENV=test or it would stop the runner").toBe("test");

    const res = await request(app).get("/api/v1/shutdown");

    expect(res.status, `Shutdown from localhost should be accepted. Response: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("message", "Server is shutting down...");
    expect(res.body.data, `Teardown must be skipped in tests. Response: ${JSON.stringify(res.body)}`).toEqual({ simulated: true });
  });

  it("refuses a request forwarded by a proxy with 403", async () => {
    const res = await request(app).get("/api/v1/shutdown").set("X-Forwarded-For", "203.0.113.7");

    expect(res.status, `Forwarded shutdown request should be refused. Response: ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body).toHaveProperty("success", false);
    expect(res.body).toHaveProperty("error", "Shutdown is available from localhost only");
  });

  it("refuses a request carrying X-Real-IP or Forwarded with 403", async () => {
    for (const header of ["X-Real-IP", "Forwarded"]) {
      const res = await request(app).get("/api/v1/shutdown").set(header, "203.0.113.7");

      expect(res.status, `${header} should be refused. Response: ${JSON.stringify(res.body)}`).toBe(403);
    }
  });

  it("is still running after the refused requests", async () => {
    const res = await request(app).get("/api/v1/ping");

    expect(res.status).toBe(200);
  });
});
