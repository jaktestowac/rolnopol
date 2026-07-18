import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral gRPC port BEFORE requiring the service.
const TMP_DB = path.join(os.tmpdir(), `fs-inventory-unit-${process.pid}.json`);
process.env.INVENTORY_DB_PATH = TMP_DB;
process.env.INVENTORY_GRPC_PORT = "0";
process.env.FARM_STAY_LOG = "silent";
delete process.env.FARM_STAY_TIME_OFFSET_MS;

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const FS = path.join(__dirname, "..", "..", "external-services", "farm-stay", "inventory-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(FS, "config.js"));
const { start } = require(path.join(FS, "server", "index.js"));

let server;
let inv;
let health;

const call = (method, request = {}) => callUnary(inv, method, request);

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "inventory");
  inv = new proto.Inventory(target, grpc.credentials.createInsecure());
  health = new proto.Health(target, grpc.credentials.createInsecure());
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

describe("farm-stay inventory — health + seed", () => {
  it("Check reports SERVING with the seeded catalog", async () => {
    const reply = await callUnary(health, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.property_count).toBe(6);
  });
});

describe("farm-stay inventory — Search filters (catalog + free dates in one call)", () => {
  // A date window no other test touches, so all seeded properties are free.
  const FROM = "2031-01-10";
  const TO = "2031-01-12";

  it("returns all active properties when unfiltered", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 1 });
    expect(res.total).toBe(6);
  });

  it("filters by type", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 1, type: "cottage" });
    expect(res.properties.map((p) => p.id).sort()).toEqual(["prop-krakow-cottage", "prop-tatra-cottage"]);
  });

  it("filters by district", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 1, district: "Sopot" });
    expect(res.total).toBe(1);
    expect(res.properties[0].id).toBe("prop-baltic-room");
  });

  it("filters by capacity (guests)", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 7 });
    expect(res.properties.map((p) => p.id)).toEqual(["prop-bieszczady-camp"]);
  });

  it("filters by max_price", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 1, max_price: 50 });
    expect(res.properties.map((p) => p.id).sort()).toEqual(["prop-bieszczady-camp", "prop-masuria-camp"]);
  });

  it("excludes the caller's own listings when exclude_host_id is set", async () => {
    const res = await call("Search", { from: FROM, to: TO, guests: 1, exclude_host_id: "seed-host" });
    expect(res.total).toBe(0);
  });

  it("rejects an invalid range with INVALID_ARGUMENT", async () => {
    await expect(call("Search", { from: "2031-01-12", to: "2031-01-10", guests: 1 })).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });
});

describe("farm-stay inventory — atomic Hold / ConfirmHold / Release", () => {
  it("holds a free range, then rejects an overlapping hold with RANGE_UNAVAILABLE", async () => {
    const held = await call("Hold", { property_id: "prop-baltic-room", from: "2030-06-10", to: "2030-06-12", ttl_sec: 600 });
    expect(held.lock_id).toMatch(/^lock-/);
    expect(held.expires_at).not.toBe("");

    await expect(
      call("Hold", { property_id: "prop-baltic-room", from: "2030-06-11", to: "2030-06-13", ttl_sec: 600 }),
    ).rejects.toMatchObject({ code: grpc.status.FAILED_PRECONDITION, details: "RANGE_UNAVAILABLE" });
  });

  it("allows back-to-back ranges (half-open: checkout day == next check-in)", async () => {
    const a = await call("Hold", { property_id: "prop-masuria-camp", from: "2030-07-01", to: "2030-07-03", ttl_sec: 600 });
    const b = await call("Hold", { property_id: "prop-masuria-camp", from: "2030-07-03", to: "2030-07-05", ttl_sec: 600 });
    expect(a.lock_id).toBeTruthy();
    expect(b.lock_id).toBeTruthy();
    expect(a.lock_id).not.toBe(b.lock_id);
  });

  it("expires a hold lazily after its TTL — the range becomes bookable again", async () => {
    const first = await call("Hold", { property_id: "prop-wroclaw-loft", from: "2030-08-01", to: "2030-08-03", ttl_sec: 1 });
    expect(first.lock_id).toBeTruthy();
    // While the hold is live, the range is taken.
    await expect(
      call("Hold", { property_id: "prop-wroclaw-loft", from: "2030-08-01", to: "2030-08-03", ttl_sec: 1 }),
    ).rejects.toMatchObject({ code: grpc.status.FAILED_PRECONDITION });
    // Move the clock past the TTL — no timers, purely lazy.
    process.env.FARM_STAY_TIME_OFFSET_MS = String(5000);
    try {
      const again = await call("Hold", { property_id: "prop-wroclaw-loft", from: "2030-08-01", to: "2030-08-03", ttl_sec: 1 });
      expect(again.lock_id).toBeTruthy();
    } finally {
      delete process.env.FARM_STAY_TIME_OFFSET_MS;
    }
  });

  it("ConfirmHold makes a hold permanent; Release is idempotent", async () => {
    const held = await call("Hold", { property_id: "prop-tatra-cottage", from: "2030-09-01", to: "2030-09-03", ttl_sec: 600 });
    const confirmed = await call("ConfirmHold", { lock_id: held.lock_id });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.kind).toBe("confirmed");

    const released = await call("Release", { lock_id: held.lock_id });
    expect(released.ok).toBe(true);
    // Releasing an already-absent lock is OK (this is what makes cancel-retry safe).
    const again = await call("Release", { lock_id: held.lock_id });
    expect(again.ok).toBe(true);
    const never = await call("Release", { lock_id: "lock-does-not-exist" });
    expect(never.ok).toBe(true);
  });

  it("ConfirmHold on an unknown lock returns NOT_FOUND", async () => {
    await expect(call("ConfirmHold", { lock_id: "lock-nope" })).rejects.toMatchObject({ code: grpc.status.NOT_FOUND });
  });
});

describe("farm-stay inventory — host blackouts", () => {
  it("rejects a blackout from a non-owner with PERMISSION_DENIED", async () => {
    await expect(
      call("Hold", { property_id: "prop-krakow-cottage", from: "2030-10-01", to: "2030-10-05", kind: "blackout", host_id: "intruder" }),
    ).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
  });

  it("lets the owner blackout a range, which then blocks bookings", async () => {
    const black = await call("Hold", {
      property_id: "prop-krakow-cottage",
      from: "2030-10-01",
      to: "2030-10-05",
      kind: "blackout",
      host_id: "seed-host",
    });
    expect(black.lock_id).toBeTruthy();
    await expect(
      call("Hold", { property_id: "prop-krakow-cottage", from: "2030-10-02", to: "2030-10-03", ttl_sec: 600 }),
    ).rejects.toMatchObject({ code: grpc.status.FAILED_PRECONDITION, details: "RANGE_UNAVAILABLE" });
  });
});

describe("farm-stay inventory — GetCalendar", () => {
  it("reports day availability, marking held nights unavailable", async () => {
    await call("Hold", { property_id: "prop-bieszczady-camp", from: "2030-11-10", to: "2030-11-12", ttl_sec: 600 });
    const cal = await call("GetCalendar", { property_id: "prop-bieszczady-camp", from: "2030-11-09", to: "2030-11-13" });
    const byDate = Object.fromEntries(cal.days.map((d) => [d.date, d.available]));
    expect(byDate["2030-11-09"]).toBe(true);
    expect(byDate["2030-11-10"]).toBe(false); // held night
    expect(byDate["2030-11-11"]).toBe(false); // held night
    expect(byDate["2030-11-12"]).toBe(true); // checkout day is free again (half-open)
  });
});

describe("farm-stay inventory — listings CRUD with ownership", () => {
  let createdId;

  it("creates a property owned by the caller", async () => {
    const p = await call("CreateProperty", {
      host_id: "alice",
      name: "Alice Farmhouse",
      district: "Lublin",
      type: "cottage",
      capacity: 4,
      base_price: 110,
      policy: "flexible",
      amenities: ["wifi"],
    });
    expect(p.host_id).toBe("alice");
    expect(p.active).toBe(true);
    createdId = p.id;
  });

  it("lists a host's own properties", async () => {
    const res = await call("ListProperties", { host_id: "alice" });
    expect(res.properties.map((p) => p.id)).toContain(createdId);
    expect(res.total).toBe(1);
  });

  it("rejects an update from a non-owner with PERMISSION_DENIED", async () => {
    await expect(call("UpdateProperty", { id: createdId, host_id: "mallory", name: "Hijacked" })).rejects.toMatchObject({
      code: grpc.status.PERMISSION_DENIED,
    });
  });

  it("lets the owner update, then delete", async () => {
    const updated = await call("UpdateProperty", { id: createdId, host_id: "alice", base_price: 130 });
    expect(updated.base_price).toBe(130);
    const del = await call("DeleteProperty", { id: createdId, host_id: "alice" });
    expect(del.deleted).toBe(true);
    await expect(call("UpdateProperty", { id: createdId, host_id: "alice", name: "gone" })).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });
});
