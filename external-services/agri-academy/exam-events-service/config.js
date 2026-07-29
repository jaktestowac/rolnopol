/**
 * Config for the exam-events gRPC service (:50076).
 *
 * A LEAF: it dials no one. The exam center feeds it session clock snapshots and
 * subscribes to the tick stream; the leaf never calls back out. Env-overridable
 * in the same style as the other leaves (`0` for an ephemeral test port).
 */
const path = require("path");

const HOST = process.env.EXAM_EVENTS_GRPC_HOST || "0.0.0.0";
const PORT =
  process.env.EXAM_EVENTS_GRPC_PORT != null && process.env.EXAM_EVENTS_GRPC_PORT !== "" ? Number(process.env.EXAM_EVENTS_GRPC_PORT) : 50076;

const BIND_ADDRESS = `${HOST}:${PORT}`;
const CLIENT_TARGET = process.env.EXAM_EVENTS_TARGET || `localhost:${PORT}`;

const PROTO_PATH = path.join(__dirname, "protos", "exam-events.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const DB_PATH = process.env.EXAM_EVENTS_DB_PATH
  ? path.resolve(process.env.EXAM_EVENTS_DB_PATH)
  : path.join(__dirname, "data", "exam-events.json");

// Tick cadence bounds. A client asks for `tick_ms`; the server clamps it, so a
// hostile or careless subscriber cannot turn the clock into a busy loop. Tests
// ask for the floor and get several ticks in a few milliseconds — no sleeping.
const DEFAULT_TICK_MS = Number(process.env.EXAM_EVENTS_TICK_MS || 1000);
const MIN_TICK_MS = Number(process.env.EXAM_EVENTS_MIN_TICK_MS || 10);
const MAX_TICK_MS = Number(process.env.EXAM_EVENTS_MAX_TICK_MS || 60000);

// The append-only log is capped so a long-running dev process cannot grow the
// file without bound. A real ledger would not truncate; the latest per-session
// snapshot (which is what #94 reads) is kept separately and never dropped.
const MAX_EVENTS = Number(process.env.EXAM_EVENTS_MAX_LOG || 5000);

// ListEvents page size. A caller may ask for more than the default but never more
// than the maximum — an unbounded read of an append-only log is how one message
// ends up holding the whole thing (the mistake unary ListQuestions makes).
const EVENTS_PAGE_DEFAULT = Number(process.env.EXAM_EVENTS_PAGE_DEFAULT || 50);
const EVENTS_PAGE_MAX = Number(process.env.EXAM_EVENTS_PAGE_MAX || 500);

// WatchEvents (the live log tail). Same clamp discipline as the tick cadence: a
// subscriber ASKS for a poll interval, the server decides — so a careless page
// cannot turn the log into a busy loop.
const WATCH_POLL_MS = Number(process.env.EXAM_EVENTS_WATCH_POLL_MS || 1000);
const WATCH_MIN_POLL_MS = Number(process.env.EXAM_EVENTS_WATCH_MIN_POLL_MS || 10);
const WATCH_MAX_POLL_MS = Number(process.env.EXAM_EVENTS_WATCH_MAX_POLL_MS || 60000);

// How far a tail will catch up before it fast-forwards. A subscriber that opens at
// a very stale cursor gets the newest N entries above it and skips the rest: a
// stream still replaying history is not a tail (ListEvents is the history read).
const WATCH_BACKLOG_MAX = Number(process.env.EXAM_EVENTS_WATCH_BACKLOG_MAX || 200);

// Idle heartbeat. An append-only log can be quiet for hours, and a silent stream
// is indistinguishable from a dead one to every hop between here and a browser.
const WATCH_HEARTBEAT_MS = Number(process.env.EXAM_EVENTS_WATCH_HEARTBEAT_MS || 15000);

module.exports = {
  HOST,
  PORT,
  BIND_ADDRESS,
  CLIENT_TARGET,
  PROTO_PATH,
  PROTO_LOADER_OPTIONS,
  DB_PATH,
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
};
