import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");
const { EventEmitter } = require("events");

/**
 * The HTTP bridges that make the streaming RPCs reachable from a browser:
 *
 *   NDJSON  authoring   GET /v1/exams/:id/questions/stream   → StreamQuestionPool
 *   SSE     exam-center GET /v1/sessions/:id/clock           → WatchSessionClock
 *   SSE     exam-center GET /v1/events/stream                → WatchEvents (log tail)
 *
 * The assertion that matters most here is that each bridge RE-STREAMS. A bridge
 * that collects the whole upstream stream and then answers once passes every
 * content assertion while deleting the entire point of the feature, so both
 * bridges are driven with a raw incremental HTTP reader and asserted to deliver
 * frame N while the upstream stream is still open.
 */
const AU_PORT = 4491;
const EC_PORT = 4492;
const FAKE_AU_PORT = 4493;
const AU_DB = path.join(os.tmpdir(), `aa-au-bridge-${process.pid}.json`);
const QB_DB = path.join(os.tmpdir(), `aa-qb-bridge-${process.pid}.json`);
const EC_DB = path.join(os.tmpdir(), `aa-ec-bridge-${process.pid}.json`);
const EE_DB = path.join(os.tmpdir(), `aa-ee-bridge-${process.pid}.json`);

process.env.AUTHORING_DB_PATH = AU_DB;
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.EXAM_CENTER_DB_PATH = EC_DB;
process.env.EXAM_EVENTS_DB_PATH = EE_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.EXAM_EVENTS_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";
// Health-monitor cadence, turned right down so several probe cycles pass in a few
// milliseconds. It is an operator knob (never request-supplied), so it has no floor
// worth fighting — see the exam center's config.
process.env.EXAM_CENTER_HEALTH_STREAM_MS = "20";

const { openStream, waitUntil } = require("./helpers/stream-http");
const ROOT = path.join(__dirname, "..", "external-services", "agri-academy");

const HOUR = 60 * 60 * 1000;
// The authoring service self-seeds this unit + exam, and the question bank
// self-seeds the matching 16-question pool.
const OWNER = "demo-owner";
const EXAM = "pesticide-basics";
const POOL_SIZE = 16;
const TAKER = "bridge-taker";

function setOffset(ms) {
  if (ms == null) delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  else process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(ms);
}
function listen(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** Sessions the clock bridge streams, written straight into the store. */
function seedExamCenter() {
  const now = Date.now();
  const session = (id, extra) => ({
    id,
    userId: TAKER,
    examId: EXAM,
    snapshot: { examId: EXAM, title: "Pesticide Basics", passPct: 60, attemptsAllowed: 3 },
    seed: 1,
    answers: {},
    questions: [],
    enrolledAt: now,
    finalReason: null,
    result: null,
    ...extra,
  });
  fs.writeFileSync(
    EC_DB,
    JSON.stringify({
      version: 1,
      seq: 5,
      users: {
        [TAKER]: {
          attempts: {},
          locks: {},
          sessions: {
            // Live completion window — ticks for an hour.
            "sess-live": session("sess-live", { state: "active", startedAt: now, expiresAt: now + HOUR, accessExpiresAt: now + 2 * HOUR }),
            // Live completion window we cross with a clock OFFSET, never by waiting.
            "sess-lapse": session("sess-lapse", { state: "active", startedAt: now, expiresAt: now + 60000, accessExpiresAt: now + HOUR }),
            // Access window, never started.
            "sess-access": session("sess-access", { state: "entitled", entitledAt: now, accessExpiresAt: now + 3 * HOUR }),
            // Already finished — the clock is stopped before the stream opens.
            "sess-done": session("sess-done", {
              state: "scored",
              startedAt: now,
              expiresAt: now + HOUR,
              submittedAt: now,
              result: { scorePct: 100, passed: true, perQuestion: [], finalizedAt: new Date(now).toISOString(), certNo: null },
            }),
          },
        },
      },
    }),
    "utf8",
  );
}

let bank;
let events;
let authServer;
let ecServer;
let fakeAuthServer;
let qbInternals;
let eeInternals;

// Injected in place of the real question-bank client so a test can hold the
// upstream stream open at a chosen point and watch what the bridge has already
// written. `cancel()` records that the bridge cancelled upstream.
let fakeStream = null;
let fakeMode = "normal";
const fakeBank = {
  CANCELLED: require("@grpc/grpc-js").status.CANCELLED,
  list: async () => ({ questions: [], total: 0 }),
  streamPool() {
    if (fakeMode === "throw") throw new Error("no channel");
    fakeStream = Object.assign(new EventEmitter(), {
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    });
    return fakeStream;
  },
};

beforeAll(async () => {
  const startedBank = await require(path.join(ROOT, "question-bank-service", "server", "index.js")).start();
  bank = startedBank.server;
  process.env.QUESTION_BANK_GRPC_TARGET = `localhost:${startedBank.port}`;
  qbInternals = require(path.join(ROOT, "question-bank-service", "server", "handlers.js"))._internals;

  const startedEvents = await require(path.join(ROOT, "exam-events-service", "server", "index.js")).start();
  events = startedEvents.server;
  process.env.EXAM_EVENTS_TARGET = `localhost:${startedEvents.port}`;
  eeInternals = require(path.join(ROOT, "exam-events-service", "server", "handlers.js"))._internals;

  const authoringModule = require(path.join(ROOT, "authoring-service", "server", "index.js"));
  await require(path.join(ROOT, "authoring-service", "server", "db.js")).init();
  authServer = await listen(authoringModule.buildApp(), AU_PORT);
  fakeAuthServer = await listen(authoringModule.buildApp({ questionBank: fakeBank }), FAKE_AU_PORT);

  seedExamCenter();
  await require(path.join(ROOT, "exam-center-service", "server", "db.js")).init();
  ecServer = await listen(require(path.join(ROOT, "exam-center-service", "server", "index.js")).buildApp(), EC_PORT);
});

afterAll(async () => {
  setOffset(null);
  for (const s of [authServer, fakeAuthServer, ecServer]) if (s) await new Promise((r) => s.close(r));
  if (bank) bank.forceShutdown();
  if (events) events.forceShutdown();
  for (const f of [AU_DB, QB_DB, EC_DB, EE_DB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

afterEach(async () => {
  setOffset(null);
  fakeStream = null;
  fakeMode = "normal";
  // No test may leave a clock subscription (and its tick interval) behind.
  await waitUntil(() => eeInternals.activeClockStreams() === 0, { label: "all clock streams to close" });
  await waitUntil(() => eeInternals.activeEventStreams() === 0, { label: "all log tails to close" });
});

// ─── NDJSON bridge: authoring → StreamQuestionPool ────────────────────────────

describe("authoring NDJSON bridge — GET /v1/exams/:id/questions/stream", () => {
  const ndjson = (query = "") =>
    openStream({ port: AU_PORT, path: `/v1/exams/${EXAM}/questions/stream${query}`, headers: { "x-academy-user": OWNER } });

  it("streams the whole pool as NDJSON, terminated by an explicit `end` footer", async () => {
    const s = await ndjson();
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("application/x-ndjson");
    // Chunked, not a buffered body: the length is unknown until the pool ends.
    expect(s.headers["content-length"]).toBeUndefined();
    expect(s.headers["transfer-encoding"]).toBe("chunked");

    const lines = [];
    for (let i = 0; i < POOL_SIZE + 1; i++) lines.push(await s.nextJson());
    const questions = lines.slice(0, POOL_SIZE);
    expect(questions.map((l) => l.index)).toEqual(Array.from({ length: POOL_SIZE }, (_, i) => i));
    expect(questions.every((l) => l.type === "question" && l.question.id && l.question.text)).toBe(true);
    // The footer is how a consumer knows the stream ENDED rather than being cut.
    expect(lines[POOL_SIZE]).toEqual({ type: "end", count: POOL_SIZE });
  });

  it("gives the owner their keys by default and strips them on EVERY line for ?withKeys=0", async () => {
    const withKeys = await ndjson();
    const first = await withKeys.nextJson();
    expect(first.question.correct.length).toBeGreaterThan(0);

    const without = await ndjson("?withKeys=0");
    const stripped = [];
    for (let i = 0; i < POOL_SIZE; i++) stripped.push(await without.nextJson());
    expect(stripped.every((l) => l.question.correct.length === 0)).toBe(true);
    expect((await without.nextJson()).type).toBe("end");
  });

  it("honors ?limit", async () => {
    const s = await ndjson("?limit=4");
    const lines = [];
    for (let i = 0; i < 5; i++) lines.push(await s.nextJson());
    expect(lines.filter((l) => l.type === "question")).toHaveLength(4);
    expect(lines[4]).toEqual({ type: "end", count: 4 });
  });

  it("enforces ownership before opening anything (404 unknown exam, 403 someone else's, 401 anonymous)", async () => {
    await request(`http://127.0.0.1:${AU_PORT}`)
      .get("/v1/exams/nope/questions/stream")
      .set("x-academy-user", OWNER)
      .expect(404, { error: "EXAM_NOT_FOUND" });
    await request(`http://127.0.0.1:${AU_PORT}`)
      .get(`/v1/exams/${EXAM}/questions/stream`)
      .set("x-academy-user", "not-the-owner")
      .expect(403, { error: "FORBIDDEN" });
    await request(`http://127.0.0.1:${AU_PORT}`).get(`/v1/exams/${EXAM}/questions/stream`).expect(401);
  });

  it("RE-STREAMS: a line reaches the client while the upstream stream is still open", async () => {
    // Driven through an injected upstream we control frame by frame, so "the
    // bridge had not finished reading yet" is a fact, not an inference.
    const opening = openStream({
      port: FAKE_AU_PORT,
      path: `/v1/exams/${EXAM}/questions/stream`,
      headers: { "x-academy-user": OWNER },
    });
    await waitUntil(() => fakeStream !== null, { label: "the bridge to open its upstream stream" });

    fakeStream.emit("data", { id: "q1", type: "single", text: "First", options: [], correct: ["a"], weight: 1 });
    const s = await opening;
    expect(s.status).toBe(200);
    expect(await s.nextJson()).toMatchObject({ type: "question", index: 0, question: { id: "q1" } });
    expect(s.ended).toBe(false); // …and the upstream stream has sent nothing else yet

    fakeStream.emit("data", { id: "q2", type: "single", text: "Second", options: [], correct: ["b"], weight: 1 });
    expect(await s.nextJson()).toMatchObject({ index: 1, question: { id: "q2" } });

    fakeStream.emit("end");
    expect(await s.nextJson()).toEqual({ type: "end", count: 2 });
    expect(await s.rest()).toBe(""); // nothing after the footer
  });

  it("an upstream failure AFTER the first byte is a truncation footer, not a broken response", async () => {
    const opening = openStream({
      port: FAKE_AU_PORT,
      path: `/v1/exams/${EXAM}/questions/stream`,
      headers: { "x-academy-user": OWNER },
    });
    await waitUntil(() => fakeStream !== null, { label: "the bridge to open its upstream stream" });
    fakeStream.emit("data", { id: "q1", type: "single", text: "First", options: [], correct: [], weight: 1 });
    const s = await opening;
    await s.nextJson();

    // The status line is long gone, so the only honest way to report the failure
    // is in the body — and a consumer must be able to tell it from `end`.
    fakeStream.emit("error", { code: 14, message: "bank went away" });
    expect(await s.nextJson()).toEqual({ type: "error", error: "QUESTION_BANK_UNAVAILABLE", count: 1 });
  });

  it("an upstream failure BEFORE the first byte is a 503 — the same shape as the unary sibling", async () => {
    const opening = openStream({
      port: FAKE_AU_PORT,
      path: `/v1/exams/${EXAM}/questions/stream`,
      headers: { "x-academy-user": OWNER },
    });
    await waitUntil(() => fakeStream !== null, { label: "the bridge to open its upstream stream" });
    fakeStream.emit("error", { code: 14, message: "bank unreachable" });
    const s = await opening;
    expect(s.status).toBe(503);
    expect(JSON.parse(await s.rest())).toEqual({ error: "QUESTION_BANK_UNAVAILABLE" });
  });

  it("a client that hangs up mid-stream CANCELS the upstream gRPC call", async () => {
    qbInternals.resetPoolStreamCounters();
    const s = await ndjson();
    await s.nextJson(); // one row in…
    s.close(); // …then the browser goes away

    // The bank must observe the cancel, not keep walking the pool for nobody.
    await waitUntil(() => qbInternals.poolStreamCounters().cancels === 1, { label: "the bank to observe the cancel" });
    const counters = qbInternals.poolStreamCounters();
    expect(counters.completes).toBe(0);
    expect(counters.writes).toBeLessThan(POOL_SIZE);
  });

  it("leaves the unary sibling route untouched", async () => {
    const res = await request(`http://127.0.0.1:${AU_PORT}`).get(`/v1/exams/${EXAM}/questions`).set("x-academy-user", OWNER).expect(200);
    expect(res.body.total).toBe(POOL_SIZE);
  });
});

// ─── SSE bridge: exam-center → WatchSessionClock ──────────────────────────────

describe("exam-center SSE clock bridge — GET /v1/sessions/:id/clock", () => {
  const sse = (id, query = "?tickMs=10") =>
    openStream({ port: EC_PORT, path: `/v1/sessions/${id}/clock${query}`, headers: { "x-academy-user": TAKER } });

  it("requires identity and a session that exists", async () => {
    await request(`http://127.0.0.1:${EC_PORT}`).get("/v1/sessions/sess-live/clock").expect(401, { error: "MISSING_IDENTITY" });
    await request(`http://127.0.0.1:${EC_PORT}`)
      .get("/v1/sessions/ghost/clock")
      .set("x-academy-user", TAKER)
      .expect(404, { error: "SESSION_NOT_FOUND" });
    // Another taker's session is simply not theirs to watch.
    await request(`http://127.0.0.1:${EC_PORT}`)
      .get("/v1/sessions/sess-live/clock")
      .set("x-academy-user", "someone-else")
      .expect(404, { error: "SESSION_NOT_FOUND" });
  });

  it("RE-STREAMS ticks as SSE — the first tick arrives while the stream is still open", async () => {
    const s = await sse("sess-live");
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("text/event-stream");
    expect(s.headers["content-length"]).toBeUndefined();

    // A reconnect hint precedes the ticks so EventSource resumes on its own.
    expect((await s.nextBlock()).retry).toBeGreaterThanOrEqual(1000);

    const first = await s.nextEvent();
    expect(first.event).toBe("tick");
    expect(first.json).toMatchObject({ sessionId: "sess-live", window: "completion", state: "active", terminal: false, tick: 1 });
    // Numbers, not int64-as-string: a countdown must not do arithmetic on "59000".
    expect(typeof first.json.remainingMs).toBe("number");
    expect(typeof first.json.serverNow).toBe("number");
    expect(first.json.remainingMs).toBeGreaterThan(0);
    expect(s.ended).toBe(false); // …the upstream stream is still ticking

    const second = await s.nextEvent();
    expect(second.json.tick).toBe(2);
    expect(second.json.remainingMs).toBeLessThanOrEqual(first.json.remainingMs);
    // The deadline is stable and is the server's, not a client's.
    expect(second.json.deadlineAt).toBe(first.json.deadlineAt);
    s.close();
  });

  it("streams the ACCESS window for a session that has not started", async () => {
    const s = await sse("sess-access");
    await s.nextBlock();
    const tick = await s.nextEvent();
    expect(tick.json).toMatchObject({ window: "access", state: "entitled", terminal: false });
    s.close();
  });

  it("an already-scored session yields ONE terminal tick then `end`, and closes", async () => {
    const s = await sse("sess-done");
    await s.nextBlock();
    const tick = await s.nextEvent();
    expect(tick.json).toMatchObject({ window: "none", state: "scored", terminal: true, remainingMs: 0, tick: 1 });
    expect((await s.nextEvent()).event).toBe("end");
    expect(await s.rest()).toBe(""); // nothing after `end`
  });

  it("crossing the completion deadline by OFFSETTING the clock yields a terminal tick — no setTimeout", async () => {
    setOffset(2 * HOUR); // past sess-lapse's expiresAt
    const s = await sse("sess-lapse");
    await s.nextBlock();
    const tick = await s.nextEvent();
    expect(tick.json).toMatchObject({ terminal: true, state: "submitted", remainingMs: 0 });
    expect((await s.nextEvent()).event).toBe("end");

    // The state change came from the REST lazy-settle every read route performs —
    // the tick stream reported it, it did not cause it. Grading has NOT happened:
    // the session is frozen at `submitted` with no result, exactly as a lapse via
    // any other read route would leave it.
    setOffset(null);
    const stored = JSON.parse(fs.readFileSync(EC_DB, "utf8"));
    expect(stored.users[TAKER].sessions["sess-lapse"]).toMatchObject({ state: "submitted", finalReason: "expiry", result: null });
  });

  it("a browser that disconnects CANCELS the upstream subscription (no leaked tick interval)", async () => {
    const s = await sse("sess-live");
    await s.nextBlock();
    await s.nextEvent();
    expect(eeInternals.activeClockStreams()).toBe(1);

    s.close();
    await waitUntil(() => eeInternals.activeClockStreams() === 0, { label: "the leaf to clear the cancelled subscription" });
  });

  it("many watchers of one session each get their own stream", async () => {
    const watchers = await Promise.all([sse("sess-live"), sse("sess-live"), sse("sess-live")]);
    for (const w of watchers) {
      await w.nextBlock();
      expect((await w.nextEvent()).json.tick).toBe(1); // per-stream numbering
    }
    expect(eeInternals.activeClockStreams()).toBe(3);
    watchers.forEach((w) => w.close());
    await waitUntil(() => eeInternals.activeClockStreams() === 0, { label: "all watchers to close" });
  });

  it("clamps an abusive cadence hint server-side instead of busy-looping", async () => {
    const s = await sse("sess-live", "?tickMs=1");
    await s.nextBlock();
    expect((await s.nextEvent()).json.tick).toBe(1);
    s.close();
  });

  it("the leaf being unreachable degrades to 503 — the taker loses a countdown, not an exam", async () => {
    const examCenter = require(path.join(ROOT, "exam-center-service", "server", "index.js"));
    const offline = {
      target: "localhost:1",
      CANCELLED: 1,
      NOT_FOUND: 5,
      record: () => Promise.reject(new Error("UNAVAILABLE")),
      watchSessionClock: () => {
        throw new Error("should not be reached");
      },
    };
    const app = examCenter.buildApp({ examEvents: offline });
    const server = await listen(app, 0);
    try {
      const res = await request(`http://127.0.0.1:${server.address().port}`)
        .get("/v1/sessions/sess-live/clock")
        .set("x-academy-user", TAKER)
        .expect(503);
      expect(res.body).toEqual({ error: "EXAM_EVENTS_UNAVAILABLE" });
      // The session itself is untouched and every other route still works.
      await request(`http://127.0.0.1:${server.address().port}`).get("/v1/sessions").set("x-academy-user", TAKER).expect(200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ─── SSE bridge: exam-center → WatchEvents (the activity-log tail) ─────────────

describe("exam-center SSE activity bridge — GET /v1/events/stream", () => {
  // The leaf is fed through the exam center's own client, which is what every
  // session touch does in production — the bridge is then a pure reader.
  const examEventsClient = require(path.join(ROOT, "exam-center-service", "clients", "exam-events-client.js"));
  let n = 0;
  const feed = (extra = {}) =>
    examEventsClient.record({
      id: `sse-log-${(n += 1)}`,
      examId: EXAM,
      snapshot: { ownerUnitId: "unit-demo" },
      state: "entitled",
      accessExpiresAt: Date.now() + HOUR,
      ...extra,
    });

  const sse = (query = "?pollMs=10", headers = {}) => openStream({ port: EC_PORT, path: `/v1/events/stream${query}`, headers });

  const latestSequence = async () => {
    const page = await examEventsClient.listEvents({ limit: 1 });
    return Number(page.latest_sequence) || 0;
  };

  it("answers immediately with a `ping`, before any entry exists — the tail is not silent", async () => {
    const s = await sse(`?pollMs=10&since=${await latestSequence()}`);
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toBe("text/event-stream");
    expect(s.headers["content-length"]).toBeUndefined();
    // A reconnect hint precedes everything, so EventSource resumes on its own.
    expect((await s.nextBlock()).retry).toBeGreaterThanOrEqual(1000);

    const ping = await s.nextEvent();
    expect(ping.event).toBe("ping");
    expect(typeof ping.json.latestSequence).toBe("number");
    expect(typeof ping.json.serverNow).toBe("number");
    expect(s.ended).toBe(false);
    s.close();
  });

  it("RE-STREAMS an entry as it lands, with `id:` set to its sequence", async () => {
    const s = await sse(`?pollMs=10&since=${await latestSequence()}`);
    await s.nextBlock();
    expect((await s.nextEvent()).event).toBe("ping"); // subscribed, log quiet

    const recorded = await feed({ state: "active", expiresAt: Date.now() + HOUR });
    const frame = await s.nextEvent();
    expect(frame.event).toBe("entry");
    // `id:` is the browser's reconnect cursor — see the Last-Event-ID test below.
    expect(frame.id).toBe(String(recorded.sequence));
    expect(frame.json).toMatchObject({ sessionId: `sse-log-${n}`, state: "active", window: "completion", backlog: false });
    // Numbers, not int64-as-string: a page sorts and formats these.
    expect(typeof frame.json.sequence).toBe("number");
    expect(typeof frame.json.at).toBe("number");
    expect(typeof frame.json.deadlineAt).toBe("number");
    expect(frame.json.latestSequence).toBe(frame.json.sequence);
    // …and the tail is still open, waiting for the next one.
    expect(s.ended).toBe(false);
    s.close();
  });

  it("replays what the cursor missed as `backlog: true`, then keeps going live", async () => {
    const cursor = await latestSequence();
    await feed();
    await feed({ state: "active", expiresAt: Date.now() + HOUR });

    const s = await sse(`?pollMs=10&since=${cursor}`);
    await s.nextBlock();
    const first = await s.nextEvent();
    const second = await s.nextEvent();
    expect([first.json.backlog, second.json.backlog]).toEqual([true, true]);
    // Chronological, unlike the newest-first unary page.
    expect(second.json.sequence).toBeGreaterThan(first.json.sequence);

    await feed({ state: "scored" });
    const live = await s.nextEvent();
    expect(live.json.backlog).toBe(false);
    s.close();
  });

  it("honors Last-Event-ID over a stale `?since=` — a reconnect neither duplicates nor skips", async () => {
    const alreadySeen = await feed();
    // The browser replays the last id it saw; `?since=0` is the URL it reconnects
    // to. Honoring the header is what stops the page re-rendering rows it has.
    const s = await sse("?pollMs=10&since=0", { "last-event-id": String(alreadySeen.sequence) });
    await s.nextBlock();
    expect((await s.nextEvent()).event).toBe("ping"); // nothing above the cursor

    const next = await feed({ state: "active", expiresAt: Date.now() + HOUR });
    const frame = await s.nextEvent();
    expect(frame.json.sequence).toBe(Number(next.sequence));
    s.close();
  });

  it("a browser that disconnects CANCELS the upstream tail (no leaked poll interval)", async () => {
    const s = await sse(`?pollMs=10&since=${await latestSequence()}`);
    await s.nextBlock();
    await s.nextEvent();
    expect(eeInternals.activeEventStreams()).toBe(1);

    s.close();
    await waitUntil(() => eeInternals.activeEventStreams() === 0, { label: "the leaf to clear the cancelled tail" });
  });

  it("the unit-scoped tail resolves the unit FIRST, so a hidden unit's log stays hidden", async () => {
    // Driven through an injected authoring client: the point is that NO tail is
    // opened until the unit is known to be publicly visible, exactly as its unary
    // sibling (and the unit's own page) behaves.
    const examCenter = require(path.join(ROOT, "exam-center-service", "server", "index.js"));
    const cases = [
      { status: 404, reply: { status: 404, body: { error: "UNIT_NOT_FOUND" } }, expected: { error: "UNIT_NOT_FOUND" } },
      { status: 503, reply: { status: 503, body: null }, expected: { error: "AUTHORING_UNAVAILABLE" } },
    ];
    for (const c of cases) {
      const server = await listen(examCenter.buildApp({ authoring: { getPublicUnit: async () => c.reply } }), 0);
      try {
        const res = await request(`http://127.0.0.1:${server.address().port}`).get("/v1/units/hidden-unit/events/stream").expect(c.status);
        expect(res.body).toEqual(c.expected);
        expect(eeInternals.activeEventStreams()).toBe(0); // nothing was ever subscribed
      } finally {
        await new Promise((r) => server.close(r));
      }
    }
  });

  it("the leaf being unreachable degrades to 503 BEFORE the first byte — the unary sibling's shape", async () => {
    const examCenter = require(path.join(ROOT, "exam-center-service", "server", "index.js"));
    const offline = {
      target: "localhost:1",
      CANCELLED: 1,
      NOT_FOUND: 5,
      record: () => Promise.reject(new Error("UNAVAILABLE")),
      listEvents: () => Promise.reject(new Error("UNAVAILABLE")),
      watchEvents: () => {
        throw new Error("no channel");
      },
    };
    const server = await listen(examCenter.buildApp({ examEvents: offline }), 0);
    try {
      const res = await request(`http://127.0.0.1:${server.address().port}`).get("/v1/events/stream").expect(503);
      expect(res.body).toEqual({ error: "EXAM_EVENTS_UNAVAILABLE" });
      // The unary sibling degrades identically, which is what lets a page fall back.
      await request(`http://127.0.0.1:${server.address().port}`).get("/v1/events").expect(503, { error: "EXAM_EVENTS_UNAVAILABLE" });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("leaves the unary sibling route untouched", async () => {
    const res = await request(`http://127.0.0.1:${EC_PORT}`).get("/v1/events?limit=3").expect(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.latestSequence).toBeGreaterThan(0);
  });
});

// ─── SSE bridge: exam-center health monitor → GET /health/all/stream ───────────

describe("exam-center SSE health bridge — GET /health/all/stream", () => {
  const examCenter = require(path.join(ROOT, "exam-center-service", "server", "index.js"));

  // Waiting for the ABSENCE of an event is the one thing waitUntil cannot express.
  // Not a deadline — just a few probe cadences of real time.
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Counting stand-ins for the five probed services (HTTP and gRPC shapes). */
  function countingApp() {
    const counter = { probes: 0 };
    const http = {
      target: "stub",
      health: async () => {
        counter.probes += 1;
        return { status: 200, body: { version: "9.9.9", uptime_ms: 1234 } };
      },
    };
    const rpc = {
      target: "stub",
      health: async () => {
        counter.probes += 1;
        return { version: "9.9.9", uptime_ms: 1234 };
      },
    };
    const app = examCenter.buildApp({
      authoring: http,
      certificates: http,
      questionBank: rpc,
      grading: rpc,
      examEvents: rpc,
    });
    return { app, counter };
  }

  it("pushes the same aggregate `/health/all` returns, marking the first reading as a change", async () => {
    const { app } = countingApp();
    const server = await listen(app, 0);
    try {
      const port = server.address().port;
      const unary = await request(`http://127.0.0.1:${port}`).get("/health/all").expect(200);

      const s = await openStream({ port, path: "/health/all/stream" });
      expect(s.status).toBe(200);
      expect(s.headers["content-type"]).toBe("text/event-stream");
      expect(s.headers["content-length"]).toBeUndefined();
      expect((await s.nextBlock()).retry).toBeGreaterThanOrEqual(1000);

      const first = await s.nextEvent();
      expect(first.event).toBe("status");
      expect(first.json.overall).toBe(unary.body.overall);
      expect(first.json.services.map((x) => x.name)).toEqual(unary.body.services.map((x) => x.name));
      // A subscriber's first reading is new TO IT, so it is always `changed`.
      expect(first.json.changed).toBe(true);
      expect(typeof first.json.at).toBe("number");

      // A quiet cycle still reports (uptime moves on) but says nothing changed.
      const quiet = await s.nextEvent();
      expect(quiet.json.changed).toBe(false);
      expect(quiet.json.overall).toBe(first.json.overall);
      expect(s.ended).toBe(false); // health has no end state
      s.close();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("runs ONE probe cycle for ALL subscribers — the reason this is a stream and not a poll", async () => {
    const { app, counter } = countingApp();
    const server = await listen(app, 0);
    try {
      const port = server.address().port;
      const watchers = await Promise.all([1, 2, 3].map(() => openStream({ port, path: "/health/all/stream" })));
      for (const w of watchers) await w.nextBlock();

      const FRAMES = 3;
      for (const w of watchers) for (let i = 0; i < FRAMES; i++) expect((await w.nextEvent()).event).toBe("status");

      // Five services dialed once per CYCLE. Three browsers polling on their own would
      // have spent ~3× that; the bound below is what makes the sharing observable.
      expect(counter.probes).toBeGreaterThanOrEqual(5 * FRAMES - 5);
      expect(counter.probes).toBeLessThan(5 * FRAMES * 2);

      // …and the loop belongs to the subscribers: the last one out turns it off.
      watchers.forEach((w) => w.close());
      await settle(60);
      const idle = counter.probes;
      await settle(120); // several cadences with nobody watching
      expect(counter.probes).toBe(idle);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("a new subscriber gets the last reading immediately instead of waiting out a cycle", async () => {
    const { app } = countingApp();
    const server = await listen(app, 0);
    try {
      const port = server.address().port;
      const first = await openStream({ port, path: "/health/all/stream" });
      await first.nextBlock();
      await first.nextEvent(); // the loop is now running and has a cached reading

      const late = await openStream({ port, path: "/health/all/stream" });
      await late.nextBlock();
      // Delivered from the cache, so it does not stare at "Checking status…" for a
      // whole cadence — and it is flagged `changed` because it is new to this reader.
      const frame = await late.nextEvent();
      expect(frame.event).toBe("status");
      expect(frame.json.changed).toBe(true);
      expect(frame.json.services).toHaveLength(6);
      first.close();
      late.close();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ─── The clock tick view (pure) ───────────────────────────────────────────────

describe("exam-center — clockTickView", () => {
  const { clockTickView } = require(path.join(ROOT, "exam-center-service", "server", "index.js"));

  it("coerces every int64-as-string field a countdown does arithmetic on", () => {
    expect(
      clockTickView({
        session_id: "s1",
        window: "completion",
        remaining_ms: "59000",
        deadline_at: "1700000000000",
        state: "active",
        terminal: false,
        tick: "7",
        server_now: "1699999941000",
      }),
    ).toEqual({
      sessionId: "s1",
      window: "completion",
      remainingMs: 59000,
      deadlineAt: 1700000000000,
      state: "active",
      terminal: false,
      tick: 7,
      serverNow: 1699999941000,
    });
  });

  it("a terminal tick's zeroes survive the coercion", () => {
    const view = clockTickView({
      session_id: "s1",
      window: "none",
      remaining_ms: "0",
      deadline_at: "0",
      state: "scored",
      terminal: true,
      tick: "1",
      server_now: "0",
    });
    expect(view).toMatchObject({ remainingMs: 0, deadlineAt: 0, terminal: true, serverNow: 0 });
  });
});
