import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral gRPC port BEFORE requiring the service.
const TMP_DB = path.join(os.tmpdir(), `aa-ee-unit-${process.pid}.json`);
process.env.EXAM_EVENTS_DB_PATH = TMP_DB;
process.env.EXAM_EVENTS_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const { waitUntil } = require("../helpers/stream-http");
const EE = path.join(__dirname, "..", "..", "external-services", "agri-academy", "exam-events-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(EE, "config.js"));
const { start } = require(path.join(EE, "server", "index.js"));
const { _internals } = require(path.join(EE, "server", "handlers.js"));
const { projectClock } = require(path.join(EE, "server", "clock-projection.js"));

// Every deadline in this file is crossed by MOVING THE CLOCK, never by waiting.
const HOUR = 60 * 60 * 1000;
const BASE = Date.now();

function setOffset(ms) {
  if (ms == null) delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  else process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(ms);
}

let server;
let ee;
let health;

/** Collect frames until the stream ends. A clean CANCELLED counts as an end. */
function drain(stream) {
  return new Promise((resolve, reject) => {
    const frames = [];
    stream.on("data", (f) => frames.push(f));
    stream.on("end", () => resolve({ frames, completed: true }));
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve({ frames, completed: false }) : reject(err)));
  });
}

/**
 * Accumulate a stream's frames into a live array without waiting for it to end.
 *
 * WatchEvents never ends, so a tail test asserts on what HAS arrived (via
 * waitUntil) rather than on a completed collection. `ended` proves the negative:
 * a tail that closed itself is a bug, not a completion.
 */
function collect(stream) {
  const state = { frames: [], ended: false, error: null };
  stream.on("data", (f) => state.frames.push(f));
  stream.on("end", () => {
    state.ended = true;
  });
  stream.on("error", (err) => {
    if (err.code !== grpc.status.CANCELLED) state.error = err;
  });
  return state;
}

/** Resolve with the first N frames (leaving the stream open). */
function take(stream, n) {
  return new Promise((resolve, reject) => {
    const frames = [];
    stream.on("data", (f) => {
      frames.push(f);
      if (frames.length === n) resolve(frames);
    });
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve(frames) : reject(err)));
    stream.on("end", () => resolve(frames));
  });
}

const record = (snapshot) => callUnary(ee, "RecordSessionClock", snapshot);

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "examevents");
  ee = new proto.ExamEvents(target, grpc.credentials.createInsecure());
  health = new proto.Health(target, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
  setOffset(null);
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

beforeEach(() => setOffset(null));
afterEach(async () => {
  setOffset(null);
  // No stream may outlive its test — a leaked tick/poll interval is the bug the
  // active-stream counters exist to catch.
  await waitUntil(() => _internals.activeClockStreams() === 0, { label: "all clock streams to close" });
  await waitUntil(() => _internals.activeEventStreams() === 0, { label: "all event tails to close" });
});

// ─── The projection, as a pure function ───────────────────────────────────────

describe("exam-events — projectClock (pure)", () => {
  it("counts down the ACCESS window for an entitled session", () => {
    const t = projectClock({ state: "entitled", access_expires_at: BASE + 2 * HOUR }, BASE);
    expect(t).toEqual({ window: "access", remaining_ms: 2 * HOUR, deadline_at: BASE + 2 * HOUR, state: "entitled", terminal: false });
  });

  it("counts down the COMPLETION window for an active session", () => {
    const t = projectClock({ state: "active", expires_at: BASE + 60000, access_expires_at: BASE + 5 * HOUR }, BASE);
    // The completion window wins while an attempt is running, even though the
    // access window is still open — one RPC, both clocks, no ambiguity.
    expect(t.window).toBe("completion");
    expect(t.deadline_at).toBe(BASE + 60000);
    expect(t.remaining_ms).toBe(60000);
  });

  it("treats the payment TTL as the access window for awaiting_payment", () => {
    const t = projectClock({ state: "awaiting_payment", activation_expires_at: BASE + 900000 }, BASE);
    expect(t).toMatchObject({ window: "access", remaining_ms: 900000, state: "awaiting_payment", terminal: false });
  });

  it("projects a lapsed window to the SAME state the exam center would settle to", () => {
    // Mirrors settle(): active → submitted, entitled → expired_unstarted,
    // awaiting_payment → abandoned. A projection, not a decision.
    expect(projectClock({ state: "active", expires_at: BASE - 1 }, BASE)).toMatchObject({ state: "submitted", terminal: true });
    expect(projectClock({ state: "entitled", access_expires_at: BASE - 1 }, BASE)).toMatchObject({
      state: "expired_unstarted",
      terminal: true,
    });
    expect(projectClock({ state: "awaiting_payment", activation_expires_at: BASE - 1 }, BASE)).toMatchObject({
      state: "abandoned",
      terminal: true,
    });
  });

  it("a deadline landing exactly on `now` is lapsed (inclusive), and remaining is never negative", () => {
    const exact = projectClock({ state: "active", expires_at: BASE }, BASE);
    expect(exact).toMatchObject({ terminal: true, remaining_ms: 0, state: "submitted" });
    expect(projectClock({ state: "active", expires_at: BASE - HOUR }, BASE).remaining_ms).toBe(0);
  });

  it("every already-terminal state stops the clock immediately", () => {
    for (const state of ["submitted", "scored", "expired_scored", "expired_unstarted", "abandoned"]) {
      expect(projectClock({ state, expires_at: BASE + HOUR }, BASE)).toEqual({
        window: "none",
        remaining_ms: 0,
        deadline_at: 0,
        state,
        terminal: true,
      });
    }
  });

  it("an unknown or missing state stops the clock rather than ticking forever", () => {
    expect(projectClock({ state: "teleported" }, BASE)).toMatchObject({ terminal: true, state: "teleported" });
    expect(projectClock({}, BASE)).toMatchObject({ terminal: true, state: "unknown" });
    expect(projectClock(null, BASE)).toMatchObject({ terminal: true, state: "unknown" });
  });

  it("a counting state with no recorded deadline stops the clock (a feed bug is not a countdown)", () => {
    expect(projectClock({ state: "active", expires_at: 0 }, BASE)).toMatchObject({ terminal: true, state: "active" });
    expect(projectClock({ state: "entitled" }, BASE)).toMatchObject({ terminal: true, state: "entitled" });
  });

  it("accepts int64-as-string deadlines (proto-loader `longs: String`)", () => {
    const t = projectClock({ state: "active", expires_at: String(BASE + 30000) }, BASE);
    expect(t.remaining_ms).toBe(30000);
    expect(t.terminal).toBe(false);
  });
});

describe("exam-events — clampTickMs", () => {
  const { clampTickMs } = _internals;
  it("defaults an absent / non-positive hint", () => {
    expect(clampTickMs(0)).toBe(1000);
    expect(clampTickMs(-5)).toBe(1000);
    expect(clampTickMs("nope")).toBe(1000);
  });
  it("clamps to the configured floor and ceiling", () => {
    expect(clampTickMs(1)).toBe(10);
    expect(clampTickMs(250)).toBe(250);
    expect(clampTickMs(10 ** 9)).toBe(60000);
  });
});

// ─── Health + the feed ────────────────────────────────────────────────────────

describe("exam-events — health", () => {
  it("Check reports SERVING with an initialized store", async () => {
    const reply = await callUnary(health, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.db_initialized).toBe(true);
    expect(reply.version).toBeTruthy();
    expect(reply.active_clock_streams).toBe(0);
    expect(reply.active_event_streams).toBe(0);
  });
});

describe("exam-events — RecordSessionClock (feed)", () => {
  it("records a snapshot and appends to the log", async () => {
    const before = await callUnary(health, "Check", {});
    const reply = await record({ session_id: "feed-1", exam_id: "e1", state: "entitled", access_expires_at: BASE + HOUR });
    expect(reply.recorded).toBe(true);
    expect(Number(reply.sequence)).toBeGreaterThan(0);
    const after = await callUnary(health, "Check", {});
    expect(after.session_count).toBe(before.session_count + 1);
    expect(after.event_count).toBe(before.event_count + 1);
  });

  it("is idempotent — re-recording an UNCHANGED snapshot appends nothing", async () => {
    const snapshot = { session_id: "feed-2", exam_id: "e1", state: "entitled", access_expires_at: BASE + HOUR };
    await record(snapshot);
    const before = await callUnary(health, "Check", {});
    const again = await record(snapshot);
    expect(again.recorded).toBe(false);
    expect(Number(again.sequence)).toBe(0);
    const after = await callUnary(health, "Check", {});
    expect(after.event_count).toBe(before.event_count); // no growth
  });

  it("a CHANGED snapshot for the same session appends a new entry and wins", async () => {
    await record({ session_id: "feed-3", exam_id: "e1", state: "entitled", access_expires_at: BASE + HOUR });
    const moved = await record({ session_id: "feed-3", exam_id: "e1", state: "active", expires_at: Date.now() + HOUR });
    expect(moved.recorded).toBe(true);
    const stream = ee.WatchSessionClock({ session_id: "feed-3", tick_ms: 10 });
    const [tick] = await take(stream, 1);
    stream.cancel();
    expect(tick.window).toBe("completion"); // the latest snapshot is what ticks
  });

  it("carries the owning unit so the log can be read per-unit without dialing authoring", async () => {
    await record({ session_id: "feed-unit", exam_id: "e9", unit_id: "unit-7", state: "entitled", access_expires_at: BASE + HOUR });
    const page = await callUnary(ee, "ListEvents", { unit_id: "unit-7" });
    expect(page.events.map((e) => e.session_id)).toContain("feed-unit");
    expect(page.events.every((e) => e.unit_id === "unit-7")).toBe(true);
  });

  it("rejects a snapshot with no session_id or no state", async () => {
    await expect(record({ state: "entitled" })).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
    await expect(record({ session_id: "feed-4" })).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
  });
});

// ─── The tick stream ──────────────────────────────────────────────────────────

describe("exam-events — WatchSessionClock (server streaming)", () => {
  it("pushes ticks on a cadence, counting DOWN, with the server's own reading attached", async () => {
    await record({ session_id: "w-live", exam_id: "e1", state: "active", expires_at: Date.now() + HOUR });
    const stream = ee.WatchSessionClock({ session_id: "w-live", tick_ms: 10 });
    const frames = await take(stream, 3);
    stream.cancel();

    expect(frames).toHaveLength(3);
    expect(frames.map((f) => Number(f.tick))).toEqual([1, 2, 3]); // 1-based, in order
    expect(frames.every((f) => f.window === "completion" && f.state === "active" && !f.terminal)).toBe(true);
    // Monotonically non-increasing remaining, and never negative.
    const remaining = frames.map((f) => Number(f.remaining_ms));
    expect(remaining[1]).toBeLessThanOrEqual(remaining[0]);
    expect(remaining[2]).toBeLessThanOrEqual(remaining[1]);
    expect(Math.min(...remaining)).toBeGreaterThan(0);
    // deadline_at is stable; server_now advances. The tick carries the authority.
    expect(new Set(frames.map((f) => f.deadline_at)).size).toBe(1);
    expect(Number(frames[2].server_now)).toBeGreaterThanOrEqual(Number(frames[0].server_now));
    // remaining is derived from the SERVER's clock, not from anything a client sent.
    expect(Number(frames[0].deadline_at) - Number(frames[0].server_now)).toBe(Number(frames[0].remaining_ms));
  });

  it("an already-scored session yields EXACTLY ONE terminal tick and closes", async () => {
    await record({ session_id: "w-scored", exam_id: "e1", state: "scored", expires_at: BASE + HOUR });
    const { frames, completed } = await drain(ee.WatchSessionClock({ session_id: "w-scored", tick_ms: 10 }));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ terminal: true, window: "none", state: "scored", remaining_ms: "0" });
    expect(completed).toBe(true); // clean end(), not an error status
  });

  it("a clock OFFSET past expiresAt yields a terminal tick with the lazily-finalized state — no waiting", async () => {
    const expiresAt = Date.now() + 30 * 60 * 1000;
    await record({ session_id: "w-lapse", exam_id: "e1", state: "active", expires_at: expiresAt });
    setOffset(60 * 60 * 1000); // move the shared clock an hour past the deadline

    const { frames, completed } = await drain(ee.WatchSessionClock({ session_id: "w-lapse", tick_ms: 10 }));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ terminal: true, state: "submitted", remaining_ms: "0" });
    expect(Number(frames[0].deadline_at)).toBe(expiresAt);
    expect(completed).toBe(true);
  });

  it("the same session ticks live BEFORE the offset and terminates AFTER it (one clock, two readings)", async () => {
    await record({ session_id: "w-cross", exam_id: "e1", state: "entitled", access_expires_at: Date.now() + 5000 });
    const live = ee.WatchSessionClock({ session_id: "w-cross", tick_ms: 10 });
    const first = await take(live, 1);
    expect(first[0].terminal).toBe(false);
    live.cancel();
    await waitUntil(() => _internals.activeClockStreams() === 0, { label: "the live stream to close" });

    setOffset(60 * 60 * 1000);
    const lapsed = await drain(ee.WatchSessionClock({ session_id: "w-cross", tick_ms: 10 }));
    expect(lapsed.frames).toHaveLength(1);
    expect(lapsed.frames[0]).toMatchObject({ terminal: true, state: "expired_unstarted" });
  });

  it("a snapshot recorded MID-STREAM ends the stream on the next tick (the leaf dials no one)", async () => {
    await record({ session_id: "w-submit", exam_id: "e1", state: "active", expires_at: Date.now() + HOUR });
    const stream = ee.WatchSessionClock({ session_id: "w-submit", tick_ms: 10 });
    const ending = drain(stream);
    await take(stream, 1); // it is live…

    // …then the exam center tells the leaf the attempt was submitted.
    await record({ session_id: "w-submit", exam_id: "e1", state: "submitted", expires_at: Date.now() + HOUR });

    const { frames, completed } = await ending;
    expect(completed).toBe(true);
    expect(frames[frames.length - 1]).toMatchObject({ terminal: true, state: "submitted" });
    // Terminal is genuinely LAST — nothing follows it.
    expect(frames.filter((f) => f.terminal)).toHaveLength(1);
    expect(frames.slice(0, -1).every((f) => !f.terminal && f.state === "active")).toBe(true);
  });

  it("an unknown session is NOT_FOUND, not an empty stream", async () => {
    await expect(drain(ee.WatchSessionClock({ session_id: "never-recorded", tick_ms: 10 }))).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });

  it("rejects a missing session_id with INVALID_ARGUMENT", async () => {
    await expect(drain(ee.WatchSessionClock({ session_id: "", tick_ms: 10 }))).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });

  it("cancelling stops the ticking (the interval is cleared, not leaked)", async () => {
    await record({ session_id: "w-cancel", exam_id: "e1", state: "active", expires_at: Date.now() + HOUR });
    const stream = ee.WatchSessionClock({ session_id: "w-cancel", tick_ms: 10 });
    await take(stream, 2);
    expect(_internals.activeClockStreams()).toBe(1);

    stream.cancel();
    // Behavioural assertion: the handler's cleanup ran and the subscription is gone.
    await waitUntil(() => _internals.activeClockStreams() === 0, { label: "the cancelled stream to clean up" });
  });

  it("serves many concurrent subscribers of the same session independently", async () => {
    await record({ session_id: "w-fanout", exam_id: "e1", state: "active", expires_at: Date.now() + HOUR });
    const streams = [1, 2, 3].map(() => ee.WatchSessionClock({ session_id: "w-fanout", tick_ms: 10 }));
    const batches = await Promise.all(streams.map((s) => take(s, 2)));
    expect(_internals.activeClockStreams()).toBe(3);
    for (const frames of batches) {
      // Each stream numbers its OWN ticks from 1 — `tick` is per-stream, not global.
      expect(frames.map((f) => Number(f.tick))).toEqual([1, 2]);
    }
    streams.forEach((s) => s.cancel());
    await waitUntil(() => _internals.activeClockStreams() === 0, { label: "all subscribers to close" });
  });

  it("never writes session state — the leaf's store only ever grows by what it was FED", async () => {
    // The whole safety rail of #94: a tick stream is advisory. Watching a lapsed
    // session must not persist the lapse anywhere.
    await record({ session_id: "w-advisory", exam_id: "e1", state: "active", expires_at: Date.now() + 1000 });
    setOffset(HOUR);
    const { frames } = await drain(ee.WatchSessionClock({ session_id: "w-advisory", tick_ms: 10 }));
    expect(frames[0].state).toBe("submitted"); // projected…

    setOffset(null);
    const stored = JSON.parse(fs.readFileSync(TMP_DB, "utf8"));
    expect(stored.sessions["w-advisory"].state).toBe("active"); // …but nothing was written
    expect(stored.events.filter((e) => e.session_id === "w-advisory")).toHaveLength(1);
  });
});

// ─── windowAt: which clock was running, resolved WITHOUT a clock reading ───────

describe("exam-events — windowAt (pure)", () => {
  const { windowAt } = _internals;

  it("names the window and deadline each counting state was using", () => {
    expect(windowAt({ state: "entitled", access_expires_at: BASE + HOUR })).toEqual({ window: "access", deadline_at: BASE + HOUR });
    expect(windowAt({ state: "active", expires_at: BASE + 60000 })).toEqual({ window: "completion", deadline_at: BASE + 60000 });
    expect(windowAt({ state: "awaiting_payment", activation_expires_at: BASE + 900 })).toEqual({
      window: "access",
      deadline_at: BASE + 900,
    });
  });

  it("reports a stopped clock for terminal and unknown states", () => {
    for (const state of ["scored", "submitted", "abandoned", "teleported", ""]) {
      expect(windowAt({ state, expires_at: BASE + HOUR })).toEqual({ window: "none", deadline_at: 0 });
    }
  });

  it("does NOT depend on the clock — a lapsed deadline still reports its own window", () => {
    // This is what separates it from projectClock: a log entry describes the clock
    // as it was, so reading one back after the deadline must not reclassify it.
    setOffset(10 * HOUR);
    expect(windowAt({ state: "active", expires_at: BASE - HOUR })).toEqual({ window: "completion", deadline_at: BASE - HOUR });
  });
});

// ─── ListEvents: the read side the activity views use ──────────────────────────

describe("exam-events — ListEvents", () => {
  const list = (query = {}) => callUnary(ee, "ListEvents", query);
  // A dedicated unit so these assertions are independent of the rest of the file.
  const U = "unit-list";

  beforeAll(async () => {
    // A full session timeline for two exams under one unit, plus a decoy elsewhere.
    await record({ session_id: "L-1", exam_id: "ex-a", unit_id: U, state: "entitled", access_expires_at: BASE + HOUR });
    await record({ session_id: "L-1", exam_id: "ex-a", unit_id: U, state: "active", expires_at: BASE + 1800000 });
    await record({ session_id: "L-1", exam_id: "ex-a", unit_id: U, state: "scored" });
    await record({ session_id: "L-2", exam_id: "ex-b", unit_id: U, state: "entitled", access_expires_at: BASE + 2 * HOUR });
    await record({ session_id: "L-9", exam_id: "ex-z", unit_id: "unit-other", state: "entitled", access_expires_at: BASE + HOUR });
  });

  it("returns entries NEWEST FIRST", async () => {
    const page = await list({ unit_id: U });
    const seqs = page.events.map((e) => Number(e.sequence));
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(page.events[0].session_id).toBe("L-2"); // the most recent write
  });

  it("scopes to one unit, and never leaks another unit's entries", async () => {
    const page = await list({ unit_id: U });
    expect(page.events).toHaveLength(4);
    expect(page.total).toBe(4);
    expect(page.events.some((e) => e.session_id === "L-9")).toBe(false);
  });

  it("scopes to one exam, and combines with the unit filter", async () => {
    const page = await list({ unit_id: U, exam_id: "ex-a" });
    expect(page.events).toHaveLength(3);
    expect(page.events.every((e) => e.exam_id === "ex-a")).toBe(true);
    // A unit/exam pair that does not exist together is empty, not an error.
    const none = await list({ unit_id: "unit-other", exam_id: "ex-a" });
    expect(none.events).toEqual([]);
    expect(none.total).toBe(0);
  });

  it("an unscoped query spans every unit", async () => {
    const page = await list({ limit: 500 });
    const units = new Set(page.events.map((e) => e.unit_id));
    expect(units.has(U)).toBe(true);
    expect(units.has("unit-other")).toBe(true);
  });

  it("`total` counts the whole match while `returned` counts the page (so a view can say 'N of M')", async () => {
    const page = await list({ unit_id: U, limit: 2 });
    expect(page.events).toHaveLength(2);
    expect(page.returned).toBe(2);
    expect(page.total).toBe(4); // before the limit
    // The page is the NEWEST 2, not the first 2.
    expect(page.events.map((e) => e.session_id)).toEqual(["L-2", "L-1"]);
  });

  it("clamps the page size — an unbounded log read is never allowed", () => {
    const { clampLimit } = _internals;
    expect(clampLimit(0)).toBe(50); // default
    expect(clampLimit(-1)).toBe(50);
    expect(clampLimit("nope")).toBe(50);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(10 ** 6)).toBe(500); // maximum
  });

  it("`since_sequence` returns only entries ABOVE it (a poll cursor)", async () => {
    const all = await list({ unit_id: U, limit: 500 });
    const cursor = Number(all.events[all.events.length - 1].sequence); // the oldest
    const newer = await list({ unit_id: U, since_sequence: cursor });
    expect(newer.total).toBe(all.total - 1);
    expect(newer.events.every((e) => Number(e.sequence) > cursor)).toBe(true);
    // Polling from the high-water mark yields nothing new.
    const caughtUp = await list({ unit_id: U, since_sequence: Number(all.latest_sequence) });
    expect(caughtUp.events).toEqual([]);
    expect(Number(caughtUp.latest_sequence)).toBe(Number(all.latest_sequence));
  });

  it("reports the window and deadline that applied AT RECORD TIME, not now", async () => {
    const page = await list({ unit_id: U, exam_id: "ex-a", limit: 500 });
    const byState = Object.fromEntries(page.events.map((e) => [e.state, e]));
    expect(byState.entitled).toMatchObject({ window: "access", deadline_at: String(BASE + HOUR) });
    expect(byState.active).toMatchObject({ window: "completion", deadline_at: String(BASE + 1800000) });
    expect(byState.scored).toMatchObject({ window: "none", deadline_at: "0" });

    // Move the clock far past every deadline: a historical entry must not change.
    setOffset(50 * HOUR);
    const later = await list({ unit_id: U, exam_id: "ex-a", limit: 500 });
    expect(later.events).toEqual(page.events);
  });

  it("carries NO taker identity — the property that makes the log publishable", async () => {
    const page = await list({ limit: 500 });
    const FIELDS = ["sequence", "at", "kind", "session_id", "exam_id", "unit_id", "state", "window", "deadline_at"];
    for (const ev of page.events) {
      expect(Object.keys(ev).sort()).toEqual([...FIELDS].sort());
      expect(JSON.stringify(ev)).not.toMatch(/user/i);
    }
  });

  it("`latest_sequence` is the cursor a tail takes over from", async () => {
    // The contract the pages rely on: read one page, hand its high-water mark to
    // WatchEvents, receive exactly what came after it. Same field, same meaning.
    const page = await list({ unit_id: U, limit: 2 });
    const above = await list({ unit_id: U, since_sequence: Number(page.latest_sequence) });
    expect(above.events).toEqual([]);
  });

  it("the collapsed feed makes the log a TIMELINE, not a poll trace", async () => {
    // Re-recording L-2's current snapshot many times must add nothing, so the log
    // keeps reading as "what happened" rather than "how often we asked".
    const before = await list({ unit_id: U });
    for (let i = 0; i < 5; i++) {
      await record({ session_id: "L-2", exam_id: "ex-b", unit_id: U, state: "entitled", access_expires_at: BASE + 2 * HOUR });
    }
    const after = await list({ unit_id: U });
    expect(after.total).toBe(before.total);
  });
});

// ─── WatchEvents: the live tail the activity views subscribe to ────────────────

describe("exam-events — WatchEvents (server streaming, live tail)", () => {
  const tail = (request) => ee.WatchEvents({ poll_ms: 10, ...request });
  const latest = async () => Number((await callUnary(ee, "ListEvents", { limit: 1 })).latest_sequence);
  const entries = (state) => state.frames.filter((f) => !f.heartbeat);

  it("opens with a heartbeat when there is nothing to catch up on, then reports the next entry LIVE", async () => {
    // The opening heartbeat is what tells a subscriber (and the SSE bridge above it)
    // that it is connected, without making it wait for the next exam to happen.
    const cursor = await latest();
    const stream = tail({ unit_id: "unit-tail", since_sequence: cursor });
    const got = collect(stream);
    try {
      await waitUntil(() => got.frames.length >= 1, { label: "the opening heartbeat" });
      expect(got.frames[0].heartbeat).toBe(true);
      expect(got.frames[0].event).toBeFalsy();
      expect(entries(got)).toHaveLength(0);

      await record({ session_id: "T-1", exam_id: "ex-t", unit_id: "unit-tail", state: "entitled", access_expires_at: BASE + HOUR });
      await waitUntil(() => entries(got).length === 1, { label: "the new entry to arrive" });

      const [frame] = entries(got);
      expect(frame.event).toMatchObject({ session_id: "T-1", exam_id: "ex-t", unit_id: "unit-tail", state: "entitled", window: "access" });
      expect(frame.backlog).toBe(false); // observed live, not replayed
      expect(Number(frame.latest_sequence)).toBe(Number(frame.event.sequence));
      expect(got.error).toBeNull();
    } finally {
      stream.cancel();
    }
  });

  it("replays entries ABOVE the cursor as `backlog`, oldest first, before going live", async () => {
    const cursor = await latest();
    await record({ session_id: "T-2", exam_id: "ex-t", unit_id: "unit-back", state: "entitled", access_expires_at: BASE + HOUR });
    await record({ session_id: "T-2", exam_id: "ex-t", unit_id: "unit-back", state: "active", expires_at: BASE + 1800000 });

    const stream = tail({ unit_id: "unit-back", since_sequence: cursor });
    const got = collect(stream);
    try {
      await waitUntil(() => entries(got).length === 2, { label: "the catch-up frames" });
      const replayed = entries(got);
      // A tail is chronological — the opposite of ListEvents' newest-first page.
      expect(replayed.map((f) => f.event.state)).toEqual(["entitled", "active"]);
      expect(replayed.map((f) => Number(f.event.sequence))).toEqual(
        [...replayed.map((f) => Number(f.event.sequence))].sort((a, b) => a - b),
      );
      expect(replayed.every((f) => f.backlog === true)).toBe(true);

      // Anything after the subscription is live, not backlog.
      await record({ session_id: "T-2", exam_id: "ex-t", unit_id: "unit-back", state: "scored" });
      await waitUntil(() => entries(got).length === 3, { label: "the live frame" });
      expect(entries(got)[2].backlog).toBe(false);
    } finally {
      stream.cancel();
    }
  });

  it("scopes to one unit (and one exam), and never leaks another unit's entries into the tail", async () => {
    const cursor = await latest();
    const stream = tail({ unit_id: "unit-scope", exam_id: "ex-mine", since_sequence: cursor });
    const got = collect(stream);
    try {
      await waitUntil(() => got.frames.length >= 1, { label: "the opening heartbeat" });
      await record({
        session_id: "T-other",
        exam_id: "ex-mine",
        unit_id: "unit-elsewhere",
        state: "entitled",
        access_expires_at: BASE + HOUR,
      });
      await record({
        session_id: "T-exam",
        exam_id: "ex-theirs",
        unit_id: "unit-scope",
        state: "entitled",
        access_expires_at: BASE + HOUR,
      });
      await record({ session_id: "T-mine", exam_id: "ex-mine", unit_id: "unit-scope", state: "entitled", access_expires_at: BASE + HOUR });

      await waitUntil(() => entries(got).length === 1, { label: "the matching entry" });
      expect(entries(got)[0].event.session_id).toBe("T-mine");
      // Only the matching write ever becomes a frame, and the log's high-water mark
      // rides along regardless — a narrow tail still knows where the log is.
      expect(Number(entries(got)[0].latest_sequence)).toBeGreaterThanOrEqual(Number(entries(got)[0].event.sequence));
      expect(entries(got).some((f) => ["T-other", "T-exam"].includes(f.event.session_id))).toBe(false);
    } finally {
      stream.cancel();
    }
  });

  it("the idempotent feed means an unchanged snapshot produces NO frame", async () => {
    const cursor = await latest();
    const snapshot = { session_id: "T-3", exam_id: "ex-t", unit_id: "unit-idem", state: "entitled", access_expires_at: BASE + HOUR };
    const stream = tail({ unit_id: "unit-idem", since_sequence: cursor });
    const got = collect(stream);
    try {
      await record(snapshot);
      await waitUntil(() => entries(got).length === 1, { label: "the first entry" });
      for (let i = 0; i < 5; i++) await record(snapshot);
      // Give the poll several turns to deliver anything it should not have.
      await waitUntil(() => got.frames.length >= 2, { label: "another poll to run" }).catch(() => {});
      expect(entries(got)).toHaveLength(1);
    } finally {
      stream.cancel();
    }
  });

  it("NEVER terminates on its own — a log has no last entry", async () => {
    const cursor = await latest();
    const stream = tail({ unit_id: "unit-forever", since_sequence: cursor });
    const got = collect(stream);
    try {
      await record({ session_id: "T-4", exam_id: "ex-t", unit_id: "unit-forever", state: "scored" });
      // `scored` is terminal for the CLOCK stream; the log tail does not care.
      await waitUntil(() => entries(got).length === 1, { label: "the terminal-state entry" });
      expect(got.ended).toBe(false);
      expect(entries(got)[0].event.state).toBe("scored");
    } finally {
      stream.cancel();
    }
  });

  it("carries NO taker identity — the same property that makes the unary read publishable", async () => {
    const cursor = await latest();
    const stream = tail({ unit_id: "unit-anon", since_sequence: cursor });
    const got = collect(stream);
    try {
      await record({ session_id: "T-5", exam_id: "ex-t", unit_id: "unit-anon", state: "active", expires_at: BASE + HOUR });
      await waitUntil(() => entries(got).length === 1, { label: "the entry" });
      const FIELDS = ["sequence", "at", "kind", "session_id", "exam_id", "unit_id", "state", "window", "deadline_at"];
      expect(Object.keys(entries(got)[0].event).sort()).toEqual([...FIELDS].sort());
      expect(JSON.stringify(entries(got)[0])).not.toMatch(/user/i);
    } finally {
      stream.cancel();
    }
  });

  it("cancelling stops the polling (the interval is cleared, not leaked)", async () => {
    const stream = tail({ since_sequence: await latest() });
    const got = collect(stream);
    await waitUntil(() => got.frames.length >= 1, { label: "the opening heartbeat" });
    expect(_internals.activeEventStreams()).toBe(1);

    stream.cancel();
    await waitUntil(() => _internals.activeEventStreams() === 0, { label: "the cancelled tail to clean up" });
  });

  it("serves many concurrent tails independently", async () => {
    const cursor = await latest();
    const streams = [1, 2, 3].map(() => tail({ unit_id: "unit-fan", since_sequence: cursor }));
    const watchers = streams.map(collect);
    try {
      await waitUntil(() => watchers.every((w) => w.frames.length >= 1), { label: "every tail to open" });
      expect(_internals.activeEventStreams()).toBe(3);
      await record({ session_id: "T-6", exam_id: "ex-t", unit_id: "unit-fan", state: "entitled", access_expires_at: BASE + HOUR });
      await waitUntil(() => watchers.every((w) => entries(w).length === 1), { label: "every tail to report the entry" });
      for (const w of watchers) expect(entries(w)[0].event.session_id).toBe("T-6");
    } finally {
      streams.forEach((s) => s.cancel());
      await waitUntil(() => _internals.activeEventStreams() === 0, { label: "all tails to close" });
    }
  });

  it("clamps an abusive cadence hint server-side instead of busy-looping", () => {
    const { clampPollMs } = _internals;
    expect(clampPollMs(0)).toBe(1000); // default
    expect(clampPollMs(-5)).toBe(1000);
    expect(clampPollMs("nope")).toBe(1000);
    expect(clampPollMs(1)).toBe(10); // floor
    expect(clampPollMs(250)).toBe(250);
    expect(clampPollMs(10 ** 9)).toBe(60000); // ceiling
  });

  it("never writes to the store — a tail is a reader", async () => {
    const cursor = await latest();
    const stream = tail({ since_sequence: cursor });
    const got = collect(stream);
    try {
      await waitUntil(() => got.frames.length >= 1, { label: "the opening heartbeat" });
      const before = JSON.parse(fs.readFileSync(TMP_DB, "utf8"));
      await waitUntil(() => got.frames.length >= 2, { label: "more polls to run" }).catch(() => {});
      const after = JSON.parse(fs.readFileSync(TMP_DB, "utf8"));
      expect(after).toEqual(before);
    } finally {
      stream.cancel();
    }
  });
});
