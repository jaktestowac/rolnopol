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

    // verify animals count matches the source data (sum of amount field)
    const animalsData = require("../data/animals.json");
    const expectedAnimals = animalsData.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    expect(res.body.animals).toBe(expectedAnimals);

    // verify average animals per farm uses same data (active users ≈ total users for test dataset)
    const usersData = require("../data/users.json");
    const activeUsers = usersData.filter((u) => u.isActive).length;
    const farmsCount = usersData.length;
    const expectedAvgAnimalsPerFarm = farmsCount > 0 ? Number((expectedAnimals / farmsCount).toFixed(2)) : 0;
    expect(res.body.advanced.avgAnimalsPerFarm).toBe(expectedAvgAnimalsPerFarm);

    // other base stats
    const fieldsData = require("../data/fields.json");
    const totalArea = fieldsData.reduce((sum, f) => sum + (Number(f.area) || 0), 0);
    const staffData = require("../data/staff.json");
    const staffCount = staffData.length;

    expect(res.body.users).toBe(activeUsers);
    expect(res.body.farms).toBe(farmsCount);
    expect(res.body.area).toBe(totalArea);
    expect(res.body.staff).toBe(staffCount);

    // derived advanced metrics
    const expectedAvgAreaPerFarm = farmsCount > 0 ? Number((totalArea / farmsCount).toFixed(2)) : 0;
    expect(res.body.advanced.avgAreaPerFarm).toBe(expectedAvgAreaPerFarm);

    const expectedAvgStaffPerFarm = farmsCount > 0 ? Number((staffCount / farmsCount).toFixed(2)) : 0;
    expect(res.body.advanced.avgStaffPerFarm).toBe(expectedAvgStaffPerFarm);

    const expectedAvgAnimalsPerStaff = staffCount > 0 ? Number((expectedAnimals / staffCount).toFixed(2)) : 0;
    expect(res.body.advanced.avgAnimalsPerStaff).toBe(expectedAvgAnimalsPerStaff);

    // verify offer/transaction stats match marketplace data
    const marketplace = require("../data/marketplace.json");
    const activeOffers = marketplace.offers
      ? marketplace.offers.filter((offer) => offer.status === "active" || offer.status === "available").length
      : 0;
    const totalCompletedValue = Array.isArray(marketplace.transactions)
      ? marketplace.transactions.filter((tx) => tx.status === "completed").reduce((sum, tx) => sum + (Number(tx.price) || 0), 0)
      : 0;
    const totalActiveValue = marketplace.offers
      ? marketplace.offers
          .filter((offer) => offer.status === "active" || offer.status === "available")
          .reduce((sum, offer) => sum + (Number(offer.price) || 0), 0)
      : 0;
    const expectedAvgOfferValue = activeOffers > 0 ? Number((totalActiveValue / activeOffers).toFixed(2)) : 0;
    const expectedCompletedTransactions = Array.isArray(marketplace.transactions)
      ? marketplace.transactions.filter((tx) => tx.status === "completed").length
      : 0;

    expect(res.body.advanced.avgOfferValue).toBe(expectedAvgOfferValue);
    expect(res.body.advanced.completedTransactions).toBe(expectedCompletedTransactions);
    expect(res.body.advanced.totalCompletedValue).toBe(totalCompletedValue);
    expect(res.body.advanced.totalActiveValue).toBe(totalActiveValue);

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
