import { describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Webhook sink API", () => {
  it("accepts webhook payloads and returns a mock response", async () => {
    const response = await request(app)
      .post("/api/v1/testing/webhooks/sink?source=webhook-test")
      .set("Content-Type", "application/json")
      .send({ event: "field.created", id: "evt-123", payload: { name: "Field A" } })
      .expect(202);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Mock webhook accepted");
    expect(response.body.data).toEqual(
      expect.objectContaining({
        sink: "webhook",
        endpoint: "/api/v1/testing/webhooks/sink",
        method: "POST",
        path: "/api/v1/testing/webhooks/sink?source=webhook-test",
        contentType: expect.stringContaining("application/json"),
        body: expect.objectContaining({ event: "field.created" }),
        query: expect.objectContaining({ source: "webhook-test" }),
      }),
    );
  });

  it("accepts non-post methods too so it can act as a generic sink", async () => {
    const response = await request(app)
      .put("/api/v1/testing/webhooks/sink")
      .set("Content-Type", "text/plain")
      .send("hello from webhook")
      .expect(202);

    expect(response.body.success).toBe(true);
    expect(response.body.data.method).toBe("PUT");
    expect(response.body.data.endpoint).toBe("/api/v1/testing/webhooks/sink");
  });
});
