/**
 * Scoring registry (grading side) — mirrors authoring's validation registry.
 *
 * The extensibility seam: a new question type is a strategy `{ type, score }`
 * registered here (and a matching `{ type, validate }` in authoring) — no proto
 * change, no DB migration. v3 ships `single` and `multi`. `grade()` aggregates
 * per-question scores into a percentage + pass verdict.
 */
const strategies = new Map();

function register(strategy) {
  if (!strategy || !strategy.type || typeof strategy.score !== "function") {
    throw new Error("a scoring strategy needs { type, score() }");
  }
  strategies.set(strategy.type, strategy);
}

function resolve(type) {
  return strategies.get(type) || null;
}

function types() {
  return [...strategies.keys()];
}

/**
 * Score one item. Unknown types (should never reach here — rejected at authoring
 * and at the bank) score 0 but still count toward the max so the total is honest.
 */
function scoreItem(item) {
  const strategy = resolve(item.type);
  if (!strategy) {
    const weight = item.weight || 1;
    const keyLen = Array.isArray(item.key) ? item.key.length : 0;
    return { awarded: 0, max: (keyLen || 1) * weight, correct: false };
  }
  return strategy.score(item);
}

/**
 * Grade an attempt: sum per-question awards, express as a rounded percentage,
 * and compare to `passPct` (inclusive — exactly passPct passes).
 * @returns { score_pct, passed, per_question: [{ question_id, correct, awarded, max }] }
 */
function grade(items, passPct) {
  let awardedTotal = 0;
  let maxTotal = 0;
  const per_question = [];
  for (const item of items || []) {
    const { awarded, max, correct } = scoreItem(item);
    awardedTotal += awarded;
    maxTotal += max;
    per_question.push({ question_id: item.question_id, correct, awarded, max });
  }
  const score_pct = maxTotal > 0 ? Math.round((awardedTotal / maxTotal) * 100) : 0;
  return { score_pct, passed: score_pct >= (passPct || 0), per_question };
}

register(require("./single"));
register(require("./multi"));

module.exports = { register, resolve, types, scoreItem, grade };
