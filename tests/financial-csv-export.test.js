import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

describe("Financial CSV export endpoint", () => {
  it("GET /api/v1/financial/export/csv is gated by financialCsvExportEnabled flag", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { financialCsvExportEnabled: false } })
      .expect(200);

    const testUser = {
      email: `csv_export_test_${Date.now()}@test.com`,
      displayedName: "CSV Export Test",
      password: "csvexport123",
    };

    const reg = await request(app).post("/api/v1/register").send(testUser).expect(201);
    const token = reg.body.data.token;

    const resDisabled = await request(app).get("/api/v1/financial/export/csv").set("token", token).expect(404);

    expect(resDisabled.body.success).toBe(false);
    expect(resDisabled.body.error).toContain("Financial CSV export not found");

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { financialCsvExportEnabled: true } })
      .expect(200);

    const addIncome = await request(app)
      .post("/api/v1/financial/transactions")
      .set("token", token)
      .send({
        type: "income",
        amount: 123.45,
        description: "CSV income",
        category: "general",
        cardNumber: "4242424242424242",
        cvv: "123",
      })
      .expect(201);

    expect(addIncome.body.success).toBe(true);

    const resEnabled = await request(app).get("/api/v1/financial/export/csv").set("token", token).expect(200);

    expect(resEnabled.headers["content-type"]).toContain("text/csv");
    expect(resEnabled.headers["content-disposition"]).toContain("attachment;");

    const csvText = resEnabled.text;
    expect(csvText).toContain("id,timestamp,type,category,description,amount,balanceBefore,balanceAfter,referenceId");
    expect(csvText).toContain("income");
    expect(csvText).toContain("CSV income");

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });
});
