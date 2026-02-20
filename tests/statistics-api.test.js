import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Statistics API", () => {
  it("GET /api/v1/statistics returns advanced metrics payload", async () => {
    const res = await request(app).get("/api/v1/statistics").expect(200);

    expect(res.body).toHaveProperty("users");
    expect(res.body).toHaveProperty("farms");
    expect(res.body).toHaveProperty("area");
    expect(res.body).toHaveProperty("staff");
    expect(res.body).toHaveProperty("animals");
    expect(res.body).toHaveProperty("advanced");

    expect(res.body.advanced).toHaveProperty("avgAreaPerFarm");
    expect(res.body.advanced).toHaveProperty("avgAnimalsPerFarm");
    expect(res.body.advanced).toHaveProperty("avgStaffPerFarm");
    expect(res.body.advanced).toHaveProperty("avgAnimalsPerStaff");
    expect(res.body.advanced).toHaveProperty("avgOfferValue");
    expect(res.body.advanced).toHaveProperty("completedTransactions");
    expect(res.body.advanced).toHaveProperty("totalCompletedValue");
    expect(res.body.advanced).toHaveProperty("totalActiveValue");

    expect(typeof res.body.advanced.avgAreaPerFarm).toBe("number");
    expect(typeof res.body.advanced.avgAnimalsPerStaff).toBe("number");
    expect(res.body.advanced.completedTransactions).toBeGreaterThanOrEqual(0);
  });
});
