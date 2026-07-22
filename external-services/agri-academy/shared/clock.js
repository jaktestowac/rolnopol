/**
 * Server-authoritative clock for the AgriAcademy ecosystem.
 *
 * All time-based logic (access windows, completion deadlines, payment TTLs,
 * cooldown locks) reads `now()` rather than Date.now() directly, so tests can
 * cross a deadline without sleeping by setting AGRI_ACADEMY_TIME_OFFSET_MS.
 *
 * The offset is read on every call (not cached) so a test can move the clock
 * mid-run. Owned by the ecosystem — no dependency on Rolnopol.
 */
function offsetMs() {
  const raw = process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Current epoch millis, shifted by the test offset. */
function now() {
  return Date.now() + offsetMs();
}

/** Current time as an ISO string (offset-aware). */
function nowIso() {
  return new Date(now()).toISOString();
}

module.exports = { now, nowIso };
