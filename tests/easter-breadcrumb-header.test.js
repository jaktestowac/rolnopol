import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Easter Breadcrumb Header", () => {
  it("emits x-rolnopol-clue at least once within a request batch", async () => {
    let found = false;

    for (let i = 0; i < 22; i += 1) {
      const res = await request(app).get("/api/v1/healthcheck");
      if (res.headers["x-rolnopol-clue"]) {
        found = true;
        break;
      }
    }

    expect(found).toBe(true);
  });
});
