import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// Flagship test: N guests race for the last room on the same dates over the real
// wire (gateway → inventory gRPC). The atomic check-and-lock in inventory must
// resolve to EXACTLY one winner; every loser gets 409 RANGE_UNAVAILABLE. There
// is no gateway-side availability cache to go stale.
let eco;

beforeAll(async () => {
  eco = await startEcosystem({ base: 4400, tag: "race" });
});

afterAll(async () => {
  if (eco) await eco.stop();
});

describe("farm-stay — booking race (atomic hold)", () => {
  it("N parallel bookings for one range → exactly one 201, the rest 409", async () => {
    const N = 8;
    const body = { propertyId: "prop-baltic-room", from: "2030-06-10", to: "2030-06-12", guests: 1 };

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(eco.app)
          .post("/v1/bookings")
          .set("x-stay-user", `racer-${i}`)
          .send(body)
          .then((res) => res.status),
      ),
    );

    const won = results.filter((s) => s === 201).length;
    const lost = results.filter((s) => s === 409).length;
    expect(won).toBe(1);
    expect(lost).toBe(N - 1);
  });

  it("once the winner holds it, a fresh booking for the same range is still 409", async () => {
    const res = await request(eco.app)
      .post("/v1/bookings")
      .set("x-stay-user", "latecomer")
      .send({ propertyId: "prop-baltic-room", from: "2030-06-10", to: "2030-06-12", guests: 1 })
      .expect(409);
    expect(res.body.error).toBe("RANGE_UNAVAILABLE");
  });

  it("a non-overlapping range on the same property still books (201)", async () => {
    await request(eco.app)
      .post("/v1/bookings")
      .set("x-stay-user", "next-guest")
      .send({ propertyId: "prop-baltic-room", from: "2030-06-12", to: "2030-06-14", guests: 1 })
      .expect(201);
  });
});
