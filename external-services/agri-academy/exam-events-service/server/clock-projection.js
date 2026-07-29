/**
 * Pure clock projection — the whole of #94's logic, with no I/O and no timers, so
 * every deadline-crossing case is a plain function call in a test.
 *
 * `projectClock(snapshot, now)` answers one question: given what the exam center
 * last told us about this session, and the server's own clock reading, what does
 * the taker's countdown say right now?
 *
 * It deliberately MIRRORS the exam center's `settle()` state machine — a lapsed
 * window projects to the same state REST would lazily finalize it to. That is a
 * projection, not a decision: nothing here writes anything. If the two ever
 * disagree, REST wins and this is the thing that is wrong.
 */

// States where the clock is already stopped. `submitted` belongs here: the
// completion window is closed and the attempt frozen — whether grading has run
// yet is the REST path's business, not the clock's.
const TERMINAL_STATES = new Set(["submitted", "scored", "expired_scored", "expired_unstarted", "abandoned"]);

// The three states that are counting down, each with the deadline field it counts
// to and the state it projects to once that deadline passes (mirroring settle()).
const WINDOWS = {
  // The payment TTL is an access window in every way that matters to a taker:
  // it is the time left to obtain access before the enrollment lapses.
  awaiting_payment: { window: "access", field: "activation_expires_at", lapsedState: "abandoned" },
  entitled: { window: "access", field: "access_expires_at", lapsedState: "expired_unstarted" },
  active: { window: "completion", field: "expires_at", lapsedState: "submitted" },
};

// `longs: String` in the proto-loader options means int64s arrive as strings.
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A terminal tick body — the clock has stopped, whatever the reason. */
function stopped(state, deadlineAt = 0) {
  return { window: "none", remaining_ms: 0, deadline_at: deadlineAt, state, terminal: true };
}

/**
 * @param {object} snapshot the last SessionClockSnapshot the exam center fed us
 * @param {number} now      epoch millis from the shared injectable clock
 * @returns {{window: string, remaining_ms: number, deadline_at: number, state: string, terminal: boolean}}
 */
function projectClock(snapshot, now) {
  const state = String(snapshot?.state || "");
  if (!state || TERMINAL_STATES.has(state)) return stopped(state || "unknown");

  const spec = WINDOWS[state];
  // An unrecognized state stops the clock rather than streaming forever: a leaf
  // that cannot interpret a state must not pretend to count down for it.
  if (!spec) return stopped(state);

  const deadline = num(snapshot[spec.field]);
  // A counting state with no deadline recorded is a feed bug, not a countdown.
  if (deadline <= 0) return stopped(state);

  const remaining = deadline - now;
  if (remaining <= 0) return { ...stopped(spec.lapsedState, deadline) };
  return { window: spec.window, remaining_ms: remaining, deadline_at: deadline, state, terminal: false };
}

/**
 * Which window a state is counting down, and the deadline it counts to — resolved
 * WITHOUT a clock reading.
 *
 * This is what the log records at write time. A historical entry must describe the
 * clock as it was, so reading it back may never re-derive the window from "now":
 * projectClock answers "what does the countdown say?", this answers "which clock
 * was running?".
 */
function windowAt(snapshot) {
  const spec = WINDOWS[String(snapshot?.state || "")];
  if (!spec) return { window: "none", deadline_at: 0 };
  return { window: spec.window, deadline_at: num(snapshot[spec.field]) };
}

module.exports = { projectClock, windowAt, TERMINAL_STATES, WINDOWS };
