import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// One aggregated health endpoint (PRD §6): the gateway probes itself plus all
// four leaves and reports SERVING / DEGRADED / DOWN. An unreachable leaf becomes
// a UNREACHABLE entry — never a thrown error — so the report is always complete.
let eco;

beforeAll(async () => {
  eco = await startEcosystem({ base: 4440, tag: "health" });
});

afterAll(async () => {
  if (eco) await eco.stop();
});

const app = () => eco.app;

describe("farm-stay — aggregate health", () => {
  it("reports SERVING (200) with all five services up", async () => {
    const res = await request(app()).get("/health/all").expect(200);
    expect(res.body.overall).toBe("SERVING");
    const byName = Object.fromEntries(res.body.services.map((s) => [s.name, s.status]));
    expect(byName).toEqual({
      "stay-gateway": "SERVING",
      inventory: "SERVING",
      pricing: "SERVING",
      reservation: "SERVING",
      "review-desk": "SERVING",
    });
  });

  it("reports DEGRADED (503) with one leaf down, marking it UNREACHABLE", async () => {
    await eco.stopLeaf("pricing");
    try {
      const res = await request(app()).get("/health/all").expect(503);
      expect(res.body.overall).toBe("DEGRADED");
      const pricing = res.body.services.find((s) => s.name === "pricing");
      expect(pricing.status).toBe("UNREACHABLE");
      // The rest keep reporting SERVING — the report is always complete.
      expect(res.body.services.find((s) => s.name === "inventory").status).toBe("SERVING");
    } finally {
      await eco.startLeaf("pricing");
    }
  });

  it("recovers to SERVING once the leaf is back", async () => {
    const res = await request(app()).get("/health/all").expect(200);
    expect(res.body.overall).toBe("SERVING");
  });
});
