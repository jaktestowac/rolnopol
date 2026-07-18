import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// Every downstream failure has a defined, non-throwing shape (PRD §5). We kill
// one leaf at a time and assert the gateway degrades where browsing can survive
// and refuses (503) only where it genuinely cannot continue.
let eco;
const USER = "degrade-guest";
const SEARCH = "/v1/search?from=2030-06-10&to=2030-06-12&guests=1";
const PROP = "prop-masuria-camp";

beforeAll(async () => {
  eco = await startEcosystem({ base: 4430, tag: "degradation" });
});

afterAll(async () => {
  if (eco) await eco.stop();
});

const app = () => eco.app;
const book = (from, to) => request(app()).post("/v1/bookings").set("x-stay-user", USER).send({ propertyId: PROP, from, to, guests: 1 });

describe("farm-stay — graceful degradation", () => {
  it("review-desk down: search still returns results, scores become unavailable", async () => {
    await eco.stopLeaf("review");
    try {
      const res = await request(app()).get(SEARCH).set("x-stay-user", USER).expect(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.scoreStatus).toBe("unavailable");
      expect(res.body.results[0].score).toBeNull();
      expect(res.body.results[0].quoteStatus).toBe("ok"); // pricing still up
    } finally {
      await eco.startLeaf("review");
    }
  });

  it("pricing down: search degrades (quote null) and hold/confirm refuses with 503", async () => {
    await eco.stopLeaf("pricing");
    try {
      const res = await request(app()).get(SEARCH).set("x-stay-user", USER).expect(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].quote).toBeNull();
      expect(res.body.results[0].quoteStatus).toBe("unavailable");

      // Browsing degrades, but committing to a booking without a price refuses.
      await book("2030-06-20", "2030-06-22").expect(503);
    } finally {
      await eco.startLeaf("pricing");
    }
  });

  it("reservation down: booking returns 503 (the orphan hold self-expires by TTL)", async () => {
    await eco.stopLeaf("reservation");
    try {
      await book("2030-07-01", "2030-07-03").expect(503);
    } finally {
      await eco.startLeaf("reservation");
    }
  });

  it("inventory down: search refuses with 503 (the catalog itself lives there)", async () => {
    await eco.stopLeaf("inventory");
    try {
      await request(app()).get(SEARCH).set("x-stay-user", USER).expect(503);
    } finally {
      await eco.startLeaf("inventory");
    }
  });

  it("recovers fully once every leaf is back", async () => {
    const res = await request(app()).get(SEARCH).set("x-stay-user", USER).expect(200);
    expect(res.body.scoreStatus).toBe("ok");
    expect(res.body.results[0].quoteStatus).toBe("ok");
  });
});
