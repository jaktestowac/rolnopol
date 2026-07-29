/**
 * gRPC handlers for the exam-events service.
 *
 * Feed side (exam center): RecordSessionClock — idempotent, appends to the log
 * only when the snapshot actually changed. Read side: WatchSessionClock (the
 * countdown, on a cadence), ListEvents (a bounded, newest-first page of the log)
 * and WatchEvents (a live tail of the same log) — the last two are what the
 * per-unit and all-units activity views read and then subscribe to.
 *
 * Both streaming handlers re-read the store on every wake-up. That is what makes
 * "the clock stream ends when the session is submitted" and "the tail reports an
 * entry the moment it lands" work without the leaf dialing anyone: the exam center
 * records, and the very next tick/poll observes it.
 */
const grpc = require("@grpc/grpc-js");
const db = require("./db");
const clock = require("../../shared/clock");
const { projectClock, windowAt } = require("./clock-projection");
const {
  DEFAULT_TICK_MS,
  MIN_TICK_MS,
  MAX_TICK_MS,
  MAX_EVENTS,
  EVENTS_PAGE_DEFAULT,
  EVENTS_PAGE_MAX,
  WATCH_POLL_MS,
  WATCH_MIN_POLL_MS,
  WATCH_MAX_POLL_MS,
  WATCH_BACKLOG_MAX,
  WATCH_HEARTBEAT_MS,
} = require("../config");
const { createLogger } = require("../../shared/logger");

const log = createLogger("exam-events");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

// Open WatchSessionClock subscriptions. Reported by Health.Check and asserted by
// the cancellation tests — a cancelled stream that leaves its interval running is
// exactly the bug this counter exists to catch.
let activeClockStreams = 0;
// The same counter for WatchEvents tails, for the same reason.
let activeEventStreams = 0;

const SNAPSHOT_FIELDS = ["exam_id", "unit_id", "state", "activation_expires_at", "access_expires_at", "expires_at"];

function toSnapshot(request) {
  return {
    session_id: String(request.session_id),
    exam_id: String(request.exam_id || ""),
    unit_id: String(request.unit_id || ""),
    state: String(request.state || ""),
    activation_expires_at: Number(request.activation_expires_at) || 0,
    access_expires_at: Number(request.access_expires_at) || 0,
    expires_at: Number(request.expires_at) || 0,
  };
}

// Both sides have been through toSnapshot (strings for ids/state, numbers for
// deadlines), so a per-field strict compare is enough.
function sameSnapshot(a, b) {
  if (!a || !b) return false;
  return SNAPSHOT_FIELDS.every((f) => a[f] === b[f]);
}

function clampTickMs(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TICK_MS;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, Math.floor(n)));
}

function clampPollMs(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return WATCH_POLL_MS;
  return Math.min(WATCH_MAX_POLL_MS, Math.max(WATCH_MIN_POLL_MS, Math.floor(n)));
}

// ── Health ───────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const data = await db.getAll().catch(() => null);
  callback(null, {
    status: "SERVING",
    db_initialized: db.db.isInitialized === true,
    session_count: data ? Object.keys(data.sessions || {}).length : 0,
    event_count: data ? (data.events || []).length : 0,
    active_clock_streams: activeClockStreams,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
    active_event_streams: activeEventStreams,
  });
}

// ── Feed ─────────────────────────────────────────────────────────────────────

async function recordSessionClock(call, callback) {
  const snapshot = toSnapshot(call.request);
  if (!snapshot.session_id) {
    log.warn("RecordSessionClock failed", { error: "session_id required" });
    return callback({ code: grpc.status.INVALID_ARGUMENT, details: "session_id required" });
  }
  if (!snapshot.state) {
    log.warn("RecordSessionClock failed", { session: snapshot.session_id, error: "state required" });
    return callback({ code: grpc.status.INVALID_ARGUMENT, details: "state required" });
  }
  try {
    const outcome = await db.mutate((data) => {
      const previous = data.sessions?.[snapshot.session_id];
      // Idempotent: the exam center records on every session touch, and most
      // touches do not move the clock. An unchanged snapshot writes nothing.
      if (sameSnapshot(previous, snapshot)) return { value: { recorded: false, sequence: 0 } };
      const seq = (data.seq || 0) + 1;
      // The window/deadline are frozen into the entry at write time — see windowAt.
      const events = [...(data.events || []), { seq, at: clock.now(), kind: "session_clock", ...snapshot, ...windowAt(snapshot) }];
      return {
        next: {
          ...data,
          seq,
          events: events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events,
          sessions: { ...data.sessions, [snapshot.session_id]: snapshot },
        },
        value: { recorded: true, sequence: seq },
      };
    });
    callback(null, outcome);
  } catch (e) {
    log.error("RecordSessionClock failed", { session: snapshot.session_id, error: e.message });
    callback({ code: grpc.status.INTERNAL, details: e.message });
  }
}

// ── Read the log ─────────────────────────────────────────────────────────────

function clampLimit(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return EVENTS_PAGE_DEFAULT;
  return Math.min(EVENTS_PAGE_MAX, Math.floor(n));
}

/** One stored entry as the proto's ExamEvent. Never carries taker identity. */
function toEvent(entry) {
  return {
    sequence: entry.seq || 0,
    at: entry.at || 0,
    kind: entry.kind || "session_clock",
    session_id: entry.session_id || "",
    exam_id: entry.exam_id || "",
    unit_id: entry.unit_id || "",
    state: entry.state || "",
    // Entries written before the window/deadline were recorded fall back to a
    // resolved-from-state value rather than reporting a bogus zero.
    window: entry.window || windowAt(entry).window,
    deadline_at: entry.deadline_at != null ? entry.deadline_at : windowAt(entry).deadline_at,
  };
}

/**
 * ListEvents — a page of the append-only log, NEWEST FIRST.
 *
 * Unary on purpose: a table view wants "the most recent N matching entries plus
 * how many there are", which is one bounded message. (The live tail over the same
 * log is a separate, streaming concern.) `total` is the count BEFORE the limit, so
 * a page can honestly say "showing 50 of 812".
 */
async function listEvents(call, callback) {
  const unitId = String(call.request.unit_id || "");
  const examId = String(call.request.exam_id || "");
  const since = Number(call.request.since_sequence) || 0;
  const limit = clampLimit(call.request.limit);
  try {
    const data = await db.getAll();
    const all = data.events || [];
    const matching = all.filter(
      (e) => (!unitId || e.unit_id === unitId) && (!examId || e.exam_id === examId) && (!since || (e.seq || 0) > since),
    );
    // Sort a copy by sequence descending — the store's array is append-ordered and
    // must not be reordered in place.
    const newestFirst = [...matching].sort((a, b) => (b.seq || 0) - (a.seq || 0));
    const page = newestFirst.slice(0, limit).map(toEvent);
    callback(null, {
      events: page,
      total: matching.length,
      latest_sequence: all.reduce((max, e) => Math.max(max, e.seq || 0), 0),
      returned: page.length,
    });
  } catch (e) {
    log.error("ListEvents failed", { unit: unitId, exam: examId, error: e.message });
    callback({ code: grpc.status.INTERNAL, details: e.message });
  }
}

// ── Read, server streaming ───────────────────────────────────────────────────

/**
 * WatchSessionClock — push a ClockTick on a cadence until the window lapses or
 * the session reaches a terminal state, then close with a terminal tick.
 *
 * Two properties the tests lean on:
 *  - **The first tick is immediate.** A session that is already terminal (scored)
 *    or already past its deadline yields exactly one terminal tick and closes, so
 *    a deadline-crossing test never waits — it offsets the clock and reads once.
 *  - **Terminal means terminal.** `terminal: true` is always the last message and
 *    is always followed by a clean `end()`, never by an error status. A consumer
 *    that saw a terminal tick knows the stream completed; one that did not knows
 *    it was cut off.
 */
async function watchSessionClock(call) {
  const sessionId = String(call.request.session_id || "");
  const tickMs = clampTickMs(call.request.tick_ms);

  let closed = false;
  let timer = null;
  let paused = false;
  let tick = 0;

  const stop = (reason) => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    activeClockStreams -= 1;
    log.debug("WatchSessionClock closed", { session: sessionId, reason, ticks: tick });
  };
  const abort = (code, details) => {
    if (closed) return;
    stop(details);
    call.emit("error", { code, details });
  };

  if (!sessionId) {
    call.emit("error", { code: grpc.status.INVALID_ARGUMENT, details: "session_id required" });
    return;
  }

  activeClockStreams += 1;
  // Either side may leave first; every path must clear the interval exactly once.
  call.on("cancelled", () => stop("cancelled"));
  call.on("error", () => stop("error"));
  call.on("close", () => stop("close"));

  const read = async () => {
    const data = await db.getAll();
    return data.sessions?.[sessionId] || null;
  };

  let snapshot;
  try {
    snapshot = await read();
  } catch (e) {
    return abort(grpc.status.INTERNAL, e.message);
  }
  if (closed) return; // cancelled during the read
  if (!snapshot) {
    // Nothing recorded for this session. NOT_FOUND rather than an empty stream:
    // "no ticks" and "unknown session" must not look the same to a subscriber.
    return abort(grpc.status.NOT_FOUND, `unknown session: ${sessionId}`);
  }

  const emit = async () => {
    if (closed || paused) return;
    let current;
    try {
      current = await read();
    } catch (e) {
      return abort(grpc.status.INTERNAL, e.message);
    }
    if (closed) return;
    // The feed can only add snapshots, so this is a defensive branch: treat a
    // vanished snapshot as a closed clock rather than streaming stale ticks.
    if (!current) return abort(grpc.status.NOT_FOUND, `unknown session: ${sessionId}`);

    const now = clock.now();
    const projected = projectClock(current, now);
    tick += 1;
    const ok = call.write({ session_id: sessionId, ...projected, tick, server_now: now });

    if (projected.terminal) {
      stop("terminal");
      call.end();
      return;
    }
    // Backpressure: the send buffer is full, so the consumer is behind. Skip
    // ticks until it drains — a queued clock reading is worse than no reading,
    // because by the time it arrives it is already wrong.
    if (!ok) {
      paused = true;
      call.once("drain", () => {
        paused = false;
      });
    }
  };

  log.debug("WatchSessionClock opened", { session: sessionId, tick_ms: tickMs });
  await emit();
  if (closed) return;
  timer = setInterval(() => void emit(), tickMs);
}

/**
 * WatchEvents — a live tail of the append-only log, OLDEST FIRST, from a cursor.
 *
 * The streaming sibling of ListEvents: a page reads one bounded page, then tails
 * from that page's `latest_sequence` and is TOLD about everything after it. The
 * cursor semantics are deliberately identical to `EventQuery.since_sequence`, so
 * handing one read's high-water mark to the tail cannot double-deliver a row.
 *
 * Three properties the tests lean on:
 *  - **No terminal frame, ever.** A log does not finish, so this stream ends only
 *    when the subscriber cancels (or the process stops). Anything that closes it
 *    for the subscriber is a failure, not a completion.
 *  - **The first frame is immediate.** With nothing to catch up on it is a
 *    heartbeat, so a subscriber (and the SSE bridge above it) learns it is
 *    connected without waiting for the next exam to happen.
 *  - **Entries are never dropped.** A clock tick that arrives late is simply wrong,
 *    so `watchSessionClock` skips ticks under backpressure. A log entry stays true
 *    forever, so this handler stops writing and resumes at the same cursor instead.
 *
 * It polls the store rather than being pushed to: the feed is a separate unary RPC
 * whose writers do not know who is watching, and the store is a JSON file. One read
 * per poll per subscriber is the honest cost of that, and the cadence is clamped.
 */
async function watchEvents(call) {
  const unitId = String(call.request.unit_id || "");
  const examId = String(call.request.exam_id || "");
  const pollMs = clampPollMs(call.request.poll_ms);
  const matches = (e) => (!unitId || e.unit_id === unitId) && (!examId || e.exam_id === examId);

  let cursor = Number(call.request.since_sequence) || 0;
  let closed = false;
  let paused = false;
  let timer = null;
  let catchUp = true; // the first pass replays what already existed
  let frames = 0;
  // Heartbeats keep the CONNECTION alive, so they are scheduled on real elapsed
  // time — not on the injectable clock a test moves by hours. Starting at 0 is what
  // makes the very first frame of an idle tail a heartbeat.
  let lastFrameAt = 0;

  const stop = (reason) => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    activeEventStreams -= 1;
    log.debug("WatchEvents closed", { unit: unitId, exam: examId, reason, frames });
  };
  const abort = (code, details) => {
    if (closed) return;
    stop(details);
    call.emit("error", { code, details });
  };

  activeEventStreams += 1;
  call.on("cancelled", () => stop("cancelled"));
  call.on("error", () => stop("error"));
  call.on("close", () => stop("close"));

  const pump = async () => {
    if (closed || paused) return;
    let data;
    try {
      data = await db.getAll();
    } catch (e) {
      return abort(grpc.status.INTERNAL, e.message);
    }
    if (closed) return;

    const all = data.events || [];
    const latest = all.reduce((max, e) => Math.max(max, e.seq || 0), 0);
    let pending = all.filter((e) => (e.seq || 0) > cursor && matches(e)).sort((a, b) => (a.seq || 0) - (b.seq || 0));
    // Fast-forward a stale cursor rather than replaying a whole log into a tail.
    if (catchUp && pending.length > WATCH_BACKLOG_MAX) {
      log.debug("WatchEvents fast-forwarded a stale cursor", { unit: unitId, skipped: pending.length - WATCH_BACKLOG_MAX });
      pending = pending.slice(pending.length - WATCH_BACKLOG_MAX);
    }

    for (const entry of pending) {
      const ok = call.write({ event: toEvent(entry), heartbeat: false, backlog: catchUp, latest_sequence: latest });
      cursor = entry.seq || cursor;
      frames += 1;
      lastFrameAt = Date.now();
      if (!ok) {
        // The consumer is behind. Stop at this cursor — the entries after it are
        // still in the log and the next poll after `drain` picks them up in order.
        paused = true;
        call.once("drain", () => {
          paused = false;
        });
        return;
      }
    }
    // Nothing left of this poll's batch: skip past entries other filters own, so a
    // narrow tail does not rescan the whole log every time.
    cursor = Math.max(cursor, latest);
    catchUp = false;
    if (Date.now() - lastFrameAt >= WATCH_HEARTBEAT_MS) {
      call.write({ heartbeat: true, backlog: false, latest_sequence: latest });
      frames += 1;
      lastFrameAt = Date.now();
    }
  };

  log.debug("WatchEvents opened", { unit: unitId, exam: examId, since: cursor, poll_ms: pollMs });
  await pump();
  if (closed) return;
  timer = setInterval(() => void pump(), pollMs);
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  examEvents: {
    RecordSessionClock: recordSessionClock,
    WatchSessionClock: watchSessionClock,
    ListEvents: listEvents,
    WatchEvents: watchEvents,
  },
  _internals: {
    projectClock,
    windowAt,
    clampTickMs,
    clampPollMs,
    clampLimit,
    sameSnapshot,
    toEvent,
    activeClockStreams: () => activeClockStreams,
    activeEventStreams: () => activeEventStreams,
  },
};
