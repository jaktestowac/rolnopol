const { AsyncLocalStorage } = require("async_hooks");

/**
 * One lock for every operation that reads a balance and then moves money.
 *
 * JSONDatabase serializes file writes, not read-check-write sequences: two
 * requests could both read a 100 ROL balance, both pass the overdraft check,
 * and both debit. Running each money operation inside withLedgerLock makes the
 * check and the debit one step. Transfers, marketplace purchases and commodity
 * trades all touch the same financial store, so they share this single queue.
 *
 * The lock is reentrant within one async call chain (transferFunds calls
 * addTransaction), tracked with AsyncLocalStorage so a nested call runs
 * directly instead of waiting on itself.
 */
const lockContext = new AsyncLocalStorage();
let queue = Promise.resolve();

function withLedgerLock(operation) {
  if (lockContext.getStore()) {
    return operation();
  }
  const run = queue.then(() => lockContext.run(true, operation));
  queue = run.catch(() => undefined);
  return run;
}

// Money is kept to 2 decimal places; adding floats without rounding drifts
// (0.1 + 0.2 !== 0.3) and the drift accumulates in stored balances.
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// User ids arrive as numbers (stored accounts, JWT payloads after parsing) or
// strings (JWT payloads, request bodies, older seed data). Compare them the
// same way the financial service looks accounts up.
function sameUserId(a, b) {
  const left = parseInt(a, 10);
  return Number.isInteger(left) && left === parseInt(b, 10);
}

module.exports = { withLedgerLock, roundMoney, sameUserId };
