import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const { startEcosystem } = require("./helpers/farm-stay-harness");

// Cross-service consistency: a booking's lock lives in inventory while the
// booking record lives in reservation. If inventory.Release fails after a
// cancel, the booking is left `cancelled` with releaseStatus:"pending". The next
// access must retry the (idempotent) release and MarkReleaseDone — the lock must
// never leak. This is the payoff of the thin-gateway split.
let eco;

beforeAll(async () => {
  eco = await startEcosystem({ base: 4410, tag: "consistency" });
});

afterAll(async () => {
  if (eco) await eco.stop();
});

const RANGE = { propertyId: "prop-tatra-cottage", from: "2030-06-10", to: "2030-06-12", guests: 1 };

describe("farm-stay — release repair after a failed cancel", () => {
  it("heals a pending release on next access and never leaks the lock", async () => {
    // 1) Guest holds the range.
    const created = await request(eco.app).post("/v1/bookings").set("x-stay-user", "carol").send(RANGE).expect(201);
    const bookingId = created.body.bookingId;
    expect(created.body.state).toBe("hold");

    // 2) Inventory goes down, then the guest cancels. Reservation records the
    //    cancellation, but the release cannot reach inventory.
    await eco.stopLeaf("inventory");
    const cancelled = await request(eco.app).post(`/v1/bookings/${bookingId}/cancel`).set("x-stay-user", "carol").expect(200);
    expect(cancelled.body.booking.state).toBe("cancelled");
    expect(cancelled.body.booking.release_status).toBe("pending");

    // 3) Inventory comes back. Accessing the booking retries the release lazily.
    await eco.startLeaf("inventory");
    let healed;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(eco.app).get(`/v1/bookings/${bookingId}`).set("x-stay-user", "carol").expect(200);
      healed = res.body.booking;
      if (healed.release_status === "done") break;
    }
    expect(healed.release_status).toBe("done");

    // 4) Proof the lock was actually freed: a different guest can now book it.
    await request(eco.app).post("/v1/bookings").set("x-stay-user", "dave").send(RANGE).expect(201);
  });
});
