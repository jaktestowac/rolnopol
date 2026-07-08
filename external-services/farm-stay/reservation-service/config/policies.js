/**
 * Cancellation refund policies. Refund percentage is chosen by how far before
 * check-in the cancellation happens (server clock). Returns an integer percent.
 */
const DAY_MS = 86400000;

// Windows in descending order of leniency.
const TABLE = {
  flexible: { farDays: 7, far: 100, mid: 100, late: 50 },
  moderate: { farDays: 7, far: 100, mid: 50, late: 0 },
  strict: { farDays: 7, far: 50, mid: 0, late: 0 },
};

/**
 * @param {string} policy  flexible|moderate|strict
 * @param {string} checkInDate  YYYY-MM-DD
 * @param {number} nowMs  current epoch millis
 * @returns {number} refund percent (0-100)
 */
function refundPct(policy, checkInDate, nowMs) {
  const rules = TABLE[policy] || TABLE.moderate;
  const checkIn = new Date(`${checkInDate}T00:00:00Z`).getTime();
  const msUntil = checkIn - nowMs;
  const daysUntil = msUntil / DAY_MS;

  if (daysUntil >= rules.farDays) return rules.far;
  if (msUntil >= DAY_MS) return rules.mid; // between 24h and farDays
  return rules.late; // < 24h before check-in, or after
}

module.exports = { refundPct, TABLE };
