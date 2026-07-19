/**
 * Tiny randomness helpers for the mock provider. Using Math.random keeps mock
 * replies varied between calls so the assistant feels less canned. Kept in one
 * place so intents don't reach for Math.random directly.
 */

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return "";
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(probability) {
  return Math.random() < probability;
}

// Small deterministic-ish jitter for numbers, e.g. believable price wobble.
function jitter(base, spreadPct) {
  const spread = base * (spreadPct / 100);
  return base + (Math.random() * 2 - 1) * spread;
}

module.exports = { pick, chance, jitter };
