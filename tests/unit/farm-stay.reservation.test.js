import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

const TMP_DB = path.join(os.tmpdir(), `fs-reservation-unit-${process.pid}.json`);
process.env.RESERVATIONS_DB_PATH = TMP_DB;
process.env.RESERVATION_GRPC_PORT = "0";
process.env.FARM_STAY_LOG = "silent";
delete process.env.FARM_STAY_TIME_OFFSET_MS;

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const FS = path.join(__dirname, "..", "..", "external-services", "farm-stay", "reservation-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(FS, "config.js"));
const { start } = require(path.join(FS, "server", "index.js"));

let server;
let resv;

const call = (method, request = {}) => callUnary(resv, method, request);
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const DAY_MS = 86400000;

// Create a hold-state booking with a live hold, returning its id.
async function createHold({
  guestId = "guest",
  hostId = "host",
  from = "2030-06-10",
  to = "2030-06-12",
  policy = "moderate",
  quoteTotal = 100,
  holdExpiresAt = FAR_FUTURE,
} = {}) {
  const b = await call("CreateBooking", {
    guest_id: guestId,
    property_id: "prop-x",
    host_id: hostId,
    from,
    to,
    guests: 1,
    lock_id: `lock-${Math.round((Date.parse(holdExpiresAt) % 100000) + from.length)}-${to}`,
    quote_total: quoteTotal,
    hold_expires_at: holdExpiresAt,
    policy,
  });
  return b;
}

// Put the server clock X ms before a fixed check-in date, run fn, then restore.
async function atClockBeforeCheckIn(checkInDate, msBefore, fn) {
  const checkIn = Date.parse(`${checkInDate}T00:00:00Z`);
  process.env.FARM_STAY_TIME_OFFSET_MS = String(checkIn - msBefore - Date.now());
  try {
    return await fn();
  } finally {
    delete process.env.FARM_STAY_TIME_OFFSET_MS;
  }
}

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "reservation");
  resv = new proto.Reservation(`localhost:${started.port}`, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
  delete process.env.FARM_STAY_TIME_OFFSET_MS;
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("farm-stay reservation — create + confirm state machine", () => {
  it("creates a booking in hold state", async () => {
    const b = await createHold();
    expect(b.id).toMatch(/^bk-/);
    expect(b.state).toBe("hold");
    expect(b.hold_expires_at).toBe(FAR_FUTURE);
  });

  it("confirms a hold, recording the accepted total the gateway passes", async () => {
    const b = await createHold({ quoteTotal: 100 });
    const confirmed = await call("ConfirmBooking", { id: b.id, guest_id: "guest", accepted_total: 250 });
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.quote_total).toBe(250);
    expect(confirmed.hold_expires_at).toBe("");
  });

  it("rejects confirming an already-confirmed booking (FAILED_PRECONDITION)", async () => {
    const b = await createHold();
    await call("ConfirmBooking", { id: b.id, guest_id: "guest" });
    await expect(call("ConfirmBooking", { id: b.id, guest_id: "guest" })).rejects.toMatchObject({
      code: grpc.status.FAILED_PRECONDITION,
    });
  });

  it("rejects confirming another user's booking (PERMISSION_DENIED)", async () => {
    const b = await createHold();
    await expect(call("ConfirmBooking", { id: b.id, guest_id: "someone-else" })).rejects.toMatchObject({
      code: grpc.status.PERMISSION_DENIED,
    });
  });

  it("maps a missing booking to NOT_FOUND", async () => {
    await expect(call("ConfirmBooking", { id: "bk-9999", guest_id: "guest" })).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });
});

describe("farm-stay reservation — lazy expiry + completion", () => {
  it("reads a hold past holdExpiresAt as expired, and refuses to confirm it (HOLD_EXPIRED)", async () => {
    const b = await createHold({ holdExpiresAt: "2000-01-01T00:00:00.000Z" });
    const got = await call("GetBooking", { id: b.id, user_id: "guest" });
    expect(got.state).toBe("expired");
    await expect(call("ConfirmBooking", { id: b.id, guest_id: "guest" })).rejects.toMatchObject({
      code: grpc.status.FAILED_PRECONDITION,
      details: "HOLD_EXPIRED",
    });
  });

  it("reads a confirmed booking past checkout as completed", async () => {
    const b = await createHold({ from: "2030-06-10", to: "2030-06-12" });
    await call("ConfirmBooking", { id: b.id, guest_id: "guest" });
    // Move the clock well past checkout.
    process.env.FARM_STAY_TIME_OFFSET_MS = String(Date.parse("2030-07-01T00:00:00Z") - Date.now());
    try {
      const got = await call("GetBooking", { id: b.id, user_id: "guest" });
      expect(got.state).toBe("completed");
    } finally {
      delete process.env.FARM_STAY_TIME_OFFSET_MS;
    }
  });
});

describe("farm-stay reservation — cancellation refund windows", () => {
  const CHECK_IN = "2030-06-10";

  const cases = [
    { policy: "flexible", when: 8 * DAY_MS, expect: 100, label: "flexible ≥7d → 100" },
    { policy: "flexible", when: 12 * 3600000, expect: 50, label: "flexible <24h → 50" },
    { policy: "moderate", when: 3 * DAY_MS, expect: 50, label: "moderate <7d → 50" },
    { policy: "moderate", when: 12 * 3600000, expect: 0, label: "moderate <24h → 0" },
    { policy: "strict", when: 8 * DAY_MS, expect: 50, label: "strict ≥7d → 50" },
    { policy: "strict", when: 3 * DAY_MS, expect: 0, label: "strict <7d → 0" },
  ];

  for (const c of cases) {
    it(`refunds correctly: ${c.label}`, async () => {
      const b = await createHold({ policy: c.policy, from: CHECK_IN, to: "2030-06-12" });
      const res = await atClockBeforeCheckIn(CHECK_IN, c.when, () => call("CancelBooking", { id: b.id, user_id: "guest" }));
      expect(res.refund_pct).toBe(c.expect);
      expect(res.booking.state).toBe("cancelled");
      expect(res.booking.release_status).toBe("pending");
      expect(res.lock_id).toBe(b.lock_id);
    });
  }

  it("refuses to cancel an already-cancelled booking (FAILED_PRECONDITION)", async () => {
    const b = await createHold({ policy: "flexible" });
    await call("CancelBooking", { id: b.id, user_id: "guest" });
    await expect(call("CancelBooking", { id: b.id, user_id: "guest" })).rejects.toMatchObject({
      code: grpc.status.FAILED_PRECONDITION,
    });
  });
});

describe("farm-stay reservation — release status lifecycle + listing", () => {
  it("MarkReleaseDone flips releaseStatus from pending to done", async () => {
    const b = await createHold();
    const cancelled = await call("CancelBooking", { id: b.id, user_id: "guest" });
    expect(cancelled.booking.release_status).toBe("pending");
    const done = await call("MarkReleaseDone", { id: b.id, user_id: "guest" });
    expect(done.release_status).toBe("done");
  });

  it("lists bookings by role (guest vs host)", async () => {
    const b = await createHold({ guestId: "gina", hostId: "harry" });
    const asGuest = await call("ListBookings", { user_id: "gina", role: "guest" });
    expect(asGuest.bookings.find((x) => x.id === b.id)).toBeTruthy();

    const asHost = await call("ListBookings", { user_id: "harry", role: "host" });
    expect(asHost.bookings.find((x) => x.id === b.id)).toBeTruthy();

    // Gina is not a host, so a host-role query for her returns nothing of this booking.
    const ginaAsHost = await call("ListBookings", { user_id: "gina", role: "host" });
    expect(ginaAsHost.bookings.find((x) => x.id === b.id)).toBeFalsy();
  });
});
